/* globals Window */

// ## jQuery postMessage plugin

// Wraps HTML5 postMessage for cross-origin message sending between windows.
// Fallback implementation works on browsers that don't support postMessage.

// Based on concepts from: <http://benalman.com/projects/jquery-postmessage-plugin/>
// Improved for non-awesome browsers by using iframes for communication instead of  
// url fragments and polling. This technique eliminates race conditions where messages sent
// in rapid succession might not be received. It also removes the need for polling.

// ### Usage

// #### Sending a message to another window

// $.postMessage() has the following signature:

//     $.postMessage(
//         message, // The message to send (string)
//         targetHost, // The host of the target window (i.e. http://www.vistaprint.com)
//         targetWindow // A reference to the target window
//         );

// Note that the $.postMessage() API is slightly different from the HTML5 standard window.postMessage(),
// in that it requires explicitly specifying the domain of the target window. This is necessary because there's
// no way to determine the target window's domain programatically, and the domain is required for the
// polyfill technique to work.

// Example usage:

//     $.postMessage(
//         "this is a message",
//         "http://www.foo.com",
//         window.frames["fooWindow"]
//         );

// #### Listening to messages from another window

// $.receiveMessage() has the following signature:

//     $.receiveMessage(
//         messageHandler, // The message to send (string)
//         allowedOriginOrFunction // Either a domain string (i.e. http://www.something.com), 
//                                 // a wildcard (i.e. "*"), or a function that takes domain
//                                 // strings and returns true or false.
//         );

// Example usage:
// This example simply alerts every message it receives, from any origin:

//     $.receiveMessage(function(e) {
//         alert(e.data); // Alerts "this is a message"
//     });

// This example alerts every message it receives, from http://www.foo.com:

//     $.receiveMessage(
//         function(e) {
//             alert(e.data); // Alerts "this is a message"
//         },
//         "http://www.foo.com");

// This example alerts every message it receives, from any subdomain of foo.com:

//     $.receiveMessage(
//         function(e) {
//             alert(e.data); // Alerts "this is a message"
//         },
//         function(origin) {
//             return origin.search(/http:\/\/[^\.]*\.foo\.com$/gi) >= 0;
//         });

// ### Source

(function(window, $) 
{
    var cacheBuster = 1;

    var browserSupportsPostMessage = !!window.postMessage;

    // Given a URL, returns the domain portion (i.e. http://www.somedomain.com)
    function getDomainFromUrl(url) 
    {
        return url.replace(/([^:]+:\/\/[^\/]+).*/, '$1');
    }

    // Given a domain pattern (i.e. http://somedomain.com) matches against a specified domain

    // * {String or Function} originPatternOrFunction: A pattern or a function to match against sourceOrigin
    // * {String} sourceOrigin: The string to match using the originPatternOrFunction
    function isOriginMatch(originPatternOrFunction, sourceOrigin) 
    {
        if (typeof(originPatternOrFunction) == "string" && 
            sourceOrigin !== originPatternOrFunction && 
            originPatternOrFunction !== "*")
        {
            return false;
        }
        else if ($.isFunction(originPatternOrFunction) && 
            !originPatternOrFunction(sourceOrigin))
        {
            return false;
        }

        return true;
    }

    // Try to find the relationship between the current window
    // and a provided window reference.

    // * {Window} window: Current window or window sending event.
    // * {Window} target: Target window
    // * {number} level: Do not pass originally. Used only by recursion.

    // Will return a short reference string or false if cannot be found.
    function transverseLevel(window, target, level) 
    {
        if (window.frames && window.frames.length > 0) 
        {
            try 
            {
                for (var frame in window.frames) 
                {
                    try 
                    {
                        if (window.frames[0] instanceof Window && window.frames[frame] === target)
                        {
                            return 'f,' + frame;
                        }
                    } 
                    catch (e) 
                    {
                        if (e.number !== -2147024891)
                        {
                            throw e;
                        }
                    }
                }
            } 
            catch (ex) 
            {
                if (ex.number !== -2146823279)
                {
                    throw ex;
                }
            }
        }

        if (window.parent && window.parent === target)
        {
            return 'p';
        }

        if (window.opener && window.opener === target)
        {
            return 'o';
        }

        // we have already transversed deep enough
        if (level >= 4) 
        {
            return false;
        }

        var ref;
        
        if (window.frames && window.frames.length > 0) 
        {
            for (var i = 0; i < window.frames.length; i++) 
            {
                ref = transverseLevel(window.frames[i], target, level + 1);
                if (ref) 
                {
                    return 'f,' + i + '.' + ref;
                }
            }
        }

        if (window.parent && window.parent !== window) 
        {
            ref = transverseLevel(window.parent, target, level + 1);
            if (ref) 
            {
                return "p." + ref;
            }
        }

        if (window.opener && window.opener !== window) 
        {
            ref = transverseLevel(window.opener, target, level + 1);
            if (ref) 
            {
                return "o" + ref;
            }
        }

        return false;
    }

    // 1. Find the relationship between current and target window.
    // 2. Serialize a string path from the current to the target window.
    // Example: f,0.f,0 translates to window.frames[0].frames[0]
    // Example: p.p translates to window.parent.parent

    // * {Window} currentWindow: Starting window
    // * {Window|string} targetWindow: Window to determine reference to.
    function serializeWindowReference(currentWindow, targetWindow) 
    {
        // If the target window was opened with window.open(), its name is the only
        // way to get to it. This makes for a yucky API, unfortunately.
        if (typeof (targetWindow) == "string")
        {
            return ':' + targetWindow;
        }

        // first see if we can quickly find the reference
        if (currentWindow === targetWindow)
        {
            throw new Error("Trying to postMessage to self. Pointlessly useless.");
        }

        // see if the target is simple the parent
        if (currentWindow.parent && currentWindow.parent !== currentWindow && currentWindow.parent === targetWindow)
        {
            return 'p';
        }

        // see if the target is simply the opener
        if (currentWindow.opener && currentWindow.opener !== currentWindow && currentWindow.opener === targetWindow)
        {
            return 'o';
        }

        // Try to determine the relationship through recursion.
        var ref = transverseLevel(currentWindow, targetWindow);
        if (ref)
        {
            return ref;
        }
        else
        {
            throw new Error("Couldn't serialize window reference");
        }
    }

    // Sends a message to a window in a different domain.
    // * {String} message: The message to send
    // * {String} targetHost: The domain of the window to which the message should be sent
    //                               (i.e. http://www.something.com)
    // * {Window} targetWindow: A reference to the target window to which the message should be sent
    // * {string} targetWindowName: If the target window is a child window (not a frame), the window name
    //                               is required for browsers that don't support postMessage() natively.
    $.postMessage = function(message, targetHost, targetWindow, targetWindowName) 
    {
        if (!targetHost)
        {
            throw new Error("targetHost argument was not supplied to jQuery.postMessage");
        }

        if (!targetWindow)
        {
            throw new Error("No targetWindow specified");
        }

        targetHost = getDomainFromUrl(targetHost);

        // native works for:

        // * Opera 12.12 (build 1707, x64, Win7)
        // * Chrome 24.0.1312.56 m (Win7)
        // * Firefox 18.0.1 (Win7)
        if (browserSupportsPostMessage) 
        {
            try 
            {
                targetWindow.postMessage(message, targetHost);
                return;
            }
            catch (ex) 
            {
                // In IE (all known versions), postMessage() works only for iframes within the same
                // top-level window, and will fail with "No such interface supported" for calls between top-level windows.

                // * <http://blogs.msdn.com/b/ieinternals/archive/2009/09/16/bugs-in-ie8-support-for-html5-postmessage-sessionstorage-and-localstorage.aspx>
                // * <http://blogs.msdn.com/b/thebeebs/archive/2011/12/21/postmessage-popups-and-ie.aspx>

                // No such interface supported. Fall through to the polyfill technique.
                if (ex.number != -2147467262)
                {
                    throw ex;
                }
            }
        }

        // The browser does not support window.postMessage.
        // First, lets see if we can get direct access to the window instead.
        try
        {
            var postMessageDirect = targetWindow.__receiveMessageHook;
            if (postMessageDirect)
            {
                postMessageDirect(message, targetHost);
                return;
            }
        }
        catch (ex)
        {
        }

        // Direct access wont work because the targetWindow is in a different domain.
        // Create an iframe in the same domain as the target window and use it as a proxy to talk
        // to the target window. Pass the proxy information in an encoded URL fragment,
        // (not a querystring, which would cause it to load from the server)
        var serializedWindowRef = serializeWindowReference(window, targetWindowName || targetWindow),
            thisDomain = getDomainFromUrl(document.location.href),
            iframe = document.createElement('iframe');

        $('body').append(
            $(iframe)
            .hide()
            .attr('src', targetHost + '/vp/JS-Lib/jQuery/plugins/postmessage.htm#' +
                // When server side debugging, add (+new Date()) here
                (+new Date()) + cacheBuster + '&' +
                serializedWindowRef + '&' + thisDomain + '&' + encodeURIComponent(message)
            )
            .load(function() {
                // remove this DOM iframe once it is no longer needed
                $(iframe).remove();
            })
        );

        cacheBuster++;
    };

    // Assigns an event handler (callback) to receive messages sent to the window, from the specified origin.

    // * {function(Object)} callback: The event handler function to call when a message is received
    // * {string|function(string)} allowedOriginOrFunction: Either a domain string (i.e. http://www.something.com),
    //                                                     a wildcard (i.e. "*"), or a function that takes domain
    //                                                     strings and returns true or false.
    $.receiveMessage = function(callback, allowedOriginOrFunction) 
    {
        if (!callback)
        {
            throw new Error("No callback function specified");
        }

        if (!allowedOriginOrFunction)
        {
            allowedOriginOrFunction = "*";
        }

        $(window).on('message', function(event, data, origin) 
        {
            if (!data) 
            {
                data = event.originalEvent ? event.originalEvent.data : event.data;
            }

            if (!origin) 
            {
                origin = event.originalEvent ? event.originalEvent.origin : event.origin;
            }

            return isOriginMatch(allowedOriginOrFunction, event.originalEvent ? event.originalEvent.origin : origin) ?
                callback({ 'data': data, 'origin': origin }) : 
                false;
        });
    };

    // Windows in IE can only handle onmessage events from IFRAMEs within the same parent window only.
    // Messages sent between top level windows will fail. Unfortunately, we don't know if the calling window is
    // an IFrame or top-level window. To work around, listen for calls from the polyfill technique for IE in all cases.
    window.__receiveMessageHook = function(message, origin) 
    {
        $(window).trigger('message', decodeURIComponent(message), origin);
    };

})(window, jQuery);