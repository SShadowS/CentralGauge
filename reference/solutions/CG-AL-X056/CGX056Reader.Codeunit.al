codeunit 71430 "CG X056 Reader"
{
    Access = Internal;

    procedure ReadText(Source: JsonObject; PropertyName: Text): Text
    var
        Token: JsonToken;
    begin
        if not Source.Get(PropertyName, Token) then
            exit('');
        if not Token.IsValue() then
            exit('');
        if Token.AsValue().IsNull() then
            exit('');

        exit(Token.AsValue().AsText());
    end;
}
