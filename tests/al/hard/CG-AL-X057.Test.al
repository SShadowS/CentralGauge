codeunit 88810 "CG-AL-X057 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Fill(Ch: Text; Count: Integer): Text
    var
        i: Integer;
        Result: Text;
    begin
        for i := 1 to Count do
            Result += Ch;
        exit(Result);
    end;

    [Test]
    procedure ShortSourceIsReturnedUnchanged()
    var
        Fitter: Codeunit "CG X057 Fitter";
    begin
        Assert.AreEqual('abc', Fitter.Fit('abc'), 'A short value must come back unchanged');
    end;

    [Test]
    procedure ExactlyThirtyIsReturnedUnchanged()
    var
        Fitter: Codeunit "CG X057 Fitter";
        Source: Text;
    begin
        Source := Fill('a', 30);
        Assert.AreEqual(Source, Fitter.Fit(Source), 'Exactly 30 characters must come back unchanged');
    end;

    [Test]
    procedure LongSourceIsShortenedToThirty()
    var
        Fitter: Codeunit "CG X057 Fitter";
        Result: Text[30];
    begin
        Result := Fitter.Fit(Fill('b', 100));
        Assert.AreEqual(30, StrLen(Result), 'A 100 character value must be shortened to 30');
        Assert.AreEqual(Fill('b', 30), Result, 'The first 30 characters must be kept');
    end;

    [Test]
    procedure VeryLongSourceDoesNotRaise()
    var
        Fitter: Codeunit "CG X057 Fitter";
    begin
        Assert.AreEqual(30, StrLen(Fitter.Fit(Fill('c', 500))),
            'A 500 character value must be shortened, not rejected');
    end;

    [Test]
    procedure EmptySourceIsEmpty()
    var
        Fitter: Codeunit "CG X057 Fitter";
    begin
        Assert.AreEqual('', Fitter.Fit(''), 'An empty value must come back empty');
    end;
}
