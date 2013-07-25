// ## jQuery.delimitedString
// Parses key-value pairs from strings to objects, and vice-versa. 
// This is the basis for skinny.js's CSS and querystring parsing/encoding.

// ### Source

(function($)
{

// Takes a plain javascript object (key value pairs), and encodes it as a string 
// using the specified delimiters and encoders
$.encodeDelimitedString = function(data, itemDelimiter, pairDelimiter, keyEncoder, valueEncoder)
{
    if (!data)
    {
        return "";
    }

    keyEncoder = keyEncoder || function(s) { return s; };
    valueEncoder = valueEncoder || keyEncoder;

    var sb = [];

    for (var key in data)
    {
        if (data.hasOwnProperty(key))
        {
            sb.push(keyEncoder(key) + pairDelimiter + valueEncoder(data[key]));
        }
    }

    return sb.join(itemDelimiter);
};

// Takes an encoded string, and parses it into a plain javascript object (key value pairs)
// using the specified delimiters and decoders
$.parseDelimitedString = function(delimitedString, itemDelimiter, pairDelimiter, keyDecoder, valueDecoder)
{
    keyDecoder = keyDecoder || function(s) { return s; };
    valueDecoder = valueDecoder || keyDecoder;

    var ret = {};

    if (delimitedString)
    {
        var pairs = delimitedString.split(itemDelimiter);
        var len = pairs.length;
        for (var i = 0; i < len; i++)
        {
            var pair = pairs[i];

            if (pair.length > 0)
            {
                var delimIndex = pair.indexOf(pairDelimiter);

                if (delimIndex > 0 && delimIndex <= pair.length - 1) 
                {
                    var key = pair.substring(0, delimIndex);
                    var value = pair.substring(delimIndex + 1);

                    ret[keyDecoder(key)] = valueDecoder(value);
                }
            }
        }
    }

    return ret;
};

})(jQuery);