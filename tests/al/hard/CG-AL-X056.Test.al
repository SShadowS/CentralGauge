codeunit 88809 "CG-AL-X056 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Parse(Payload: Text): JsonObject
    var
        Result: JsonObject;
    begin
        Result.ReadFrom(Payload);
        exit(Result);
    end;

    [Test]
    procedure ReturnsTheTextOfAPresentScalar()
    var
        Reader: Codeunit "CG X056 Reader";
    begin
        Assert.AreEqual('widget', Reader.ReadText(Parse('{"name":"widget"}'), 'name'),
            'A present text property must be returned');
    end;

    [Test]
    procedure ReturnsEmptyWhenThePropertyIsAbsent()
    var
        Reader: Codeunit "CG X056 Reader";
    begin
        Assert.AreEqual('', Reader.ReadText(Parse('{"other":"x"}'), 'name'),
            'An absent property must yield an empty string');
    end;

    [Test]
    procedure ReturnsEmptyWhenThePropertyIsJsonNull()
    var
        Reader: Codeunit "CG X056 Reader";
    begin
        Assert.AreEqual('', Reader.ReadText(Parse('{"name":null}'), 'name'),
            'A property holding JSON null must yield an empty string, not an error');
    end;

    [Test]
    procedure ReturnsEmptyForObjectAndArrayProperties()
    var
        Reader: Codeunit "CG X056 Reader";
    begin
        Assert.AreEqual('', Reader.ReadText(Parse('{"name":{"a":1}}'), 'name'),
            'An object property must yield an empty string');
        Assert.AreEqual('', Reader.ReadText(Parse('{"name":[1,2]}'), 'name'),
            'An array property must yield an empty string');
    end;

    [Test]
    procedure HandlesAPayloadMixingAllCases()
    var
        Reader: Codeunit "CG X056 Reader";
        Payload: JsonObject;
    begin
        Payload := Parse('{"a":"first","b":null,"c":{"x":1},"d":[1]}');
        Assert.AreEqual('first', Reader.ReadText(Payload, 'a'), 'a is a scalar');
        Assert.AreEqual('', Reader.ReadText(Payload, 'b'), 'b is null');
        Assert.AreEqual('', Reader.ReadText(Payload, 'c'), 'c is an object');
        Assert.AreEqual('', Reader.ReadText(Payload, 'd'), 'd is an array');
        Assert.AreEqual('', Reader.ReadText(Payload, 'e'), 'e is absent');
    end;
}
