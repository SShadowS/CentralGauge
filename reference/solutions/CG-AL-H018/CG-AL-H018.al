codeunit 70018 "CG Request Builder"
{
    SingleInstance = true;

    var
        RequestUrl: Text;
        RequestMethod: Text;
        RequestHeaders: Dictionary of [Text, Text];
        RequestBody: Text;
        RequestTimeout: Integer;

    procedure SetUrl(Url: Text): Codeunit "CG Request Builder"
    var
        Builder: Codeunit "CG Request Builder";
    begin
        RequestUrl := Url;
        exit(Builder);
    end;

    procedure SetMethod(Method: Text): Codeunit "CG Request Builder"
    var
        Builder: Codeunit "CG Request Builder";
    begin
        RequestMethod := Method;
        exit(Builder);
    end;

    procedure AddHeader(Name: Text; Value: Text): Codeunit "CG Request Builder"
    var
        Builder: Codeunit "CG Request Builder";
    begin
        RequestHeaders.Set(Name, Value);
        exit(Builder);
    end;

    procedure SetBody(Body: Text): Codeunit "CG Request Builder"
    var
        Builder: Codeunit "CG Request Builder";
    begin
        RequestBody := Body;
        exit(Builder);
    end;

    procedure SetTimeout(Timeout: Integer): Codeunit "CG Request Builder"
    var
        Builder: Codeunit "CG Request Builder";
    begin
        RequestTimeout := Timeout;
        exit(Builder);
    end;

    procedure Build(): Text
    var
        Result: TextBuilder;
        HeaderName: Text;
        HeaderValue: Text;
    begin
        Result.AppendLine(StrSubstNo('URL: %1', RequestUrl));
        Result.AppendLine(StrSubstNo('Method: %1', RequestMethod));
        Result.AppendLine('Headers:');
        foreach HeaderName in RequestHeaders.Keys() do begin
            RequestHeaders.Get(HeaderName, HeaderValue);
            Result.AppendLine(StrSubstNo('  %1: %2', HeaderName, HeaderValue));
        end;
        Result.AppendLine(StrSubstNo('Body: %1', RequestBody));
        Result.AppendLine(StrSubstNo('Timeout: %1', RequestTimeout));
        exit(Result.ToText());
    end;

    procedure Create(): Codeunit "CG Request Builder"
    var
        Builder: Codeunit "CG Request Builder";
    begin
        Clear(RequestUrl);
        Clear(RequestMethod);
        Clear(RequestHeaders);
        Clear(RequestBody);
        Clear(RequestTimeout);
        exit(Builder);
    end;
}