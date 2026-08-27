codeunit 70027 "CG JSON Typed Getters"
{
    Access = Public;

    procedure ObjectGetBigInteger(JObj: JsonObject; "Key": Text): BigInteger
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0);
        exit(JToken.AsValue().AsBigInteger());
    end;

    procedure ObjectGetByte(JObj: JsonObject; "Key": Text): Byte
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0);
        exit(JToken.AsValue().AsByte());
    end;

    procedure ObjectGetChar(JObj: JsonObject; "Key": Text): Char
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0);
        exit(JToken.AsValue().AsChar());
    end;

    procedure ObjectGetOption(JObj: JsonObject; "Key": Text): Integer
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0);
        exit(JToken.AsValue().AsOption());
    end;

    procedure ObjectGetDateTime(JObj: JsonObject; "Key": Text): DateTime
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0DT);
        exit(JToken.AsValue().AsDateTime());
    end;

    procedure ObjectGetDate(JObj: JsonObject; "Key": Text): Date
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0D);
        exit(JToken.AsValue().AsDate());
    end;

    procedure ObjectGetTime(JObj: JsonObject; "Key": Text): Time
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0T);
        exit(JToken.AsValue().AsTime());
    end;

    procedure ObjectGetDuration(JObj: JsonObject; "Key": Text): Duration
    var
        JToken: JsonToken;
    begin
        if not JObj.Get("Key", JToken) then
            exit(0);
        exit(JToken.AsValue().AsDuration());
    end;

    procedure ObjectGetObject(JObj: JsonObject; "Key": Text): JsonObject
    var
        JToken: JsonToken;
        EmptyObject: JsonObject;
    begin
        if not JObj.Get("Key", JToken) then
            exit(EmptyObject);
        exit(JToken.AsObject());
    end;

    procedure ArrayGetBigInteger(JArr: JsonArray; Idx: Integer): BigInteger
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsBigInteger());
    end;

    procedure ArrayGetByte(JArr: JsonArray; Idx: Integer): Byte
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsByte());
    end;

    procedure ArrayGetChar(JArr: JsonArray; Idx: Integer): Char
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsChar());
    end;

    procedure ArrayGetOption(JArr: JsonArray; Idx: Integer): Integer
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsOption());
    end;

    procedure ArrayGetDateTime(JArr: JsonArray; Idx: Integer): DateTime
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsDateTime());
    end;

    procedure ArrayGetDate(JArr: JsonArray; Idx: Integer): Date
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsDate());
    end;

    procedure ArrayGetTime(JArr: JsonArray; Idx: Integer): Time
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsTime());
    end;

    procedure ArrayGetDuration(JArr: JsonArray; Idx: Integer): Duration
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsValue().AsDuration());
    end;

    procedure ArrayGetObject(JArr: JsonArray; Idx: Integer): JsonObject
    var
        JToken: JsonToken;
    begin
        JArr.Get(Idx, JToken);
        exit(JToken.AsObject());
    end;
}