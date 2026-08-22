codeunit 88817 "CG-AL-X064 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Parser: Codeunit "CG X064 Log Parser";

    [Test]
    procedure AllValidTokens()
    begin
        Assert.AreEqual(6, Parser.SumOf('1;2;3'), 'Sum of 1;2;3');
        Assert.AreEqual(3, Parser.CountOf('1;2;3'), 'Count of 1;2;3');
    end;

    [Test]
    procedure InvalidTokenBetweenValidOnes()
    begin
        // A stale-value implementation reuses the 5 for the 'x' token (17).
        Assert.AreEqual(12, Parser.SumOf('5;x;7'), 'Sum of 5;x;7 - the x token contributes nothing');
        Assert.AreEqual(2, Parser.CountOf('5;x;7'), 'Count of 5;x;7');
    end;

    [Test]
    procedure ConsecutiveInvalidTokensAfterLargeValue()
    begin
        // A stale-value implementation repeats the 100 twice (301).
        Assert.AreEqual(101, Parser.SumOf('100;x;x;1'), 'Sum of 100;x;x;1');
        Assert.AreEqual(2, Parser.CountOf('100;x;x;1'), 'Count of 100;x;x;1');
    end;

    [Test]
    procedure TrailingInvalidToken()
    begin
        // A stale-value implementation doubles the 9 (18).
        Assert.AreEqual(9, Parser.SumOf('9;end'), 'Sum of 9;end');
        Assert.AreEqual(1, Parser.CountOf('9;end'), 'Count of 9;end');
    end;

    [Test]
    procedure AllInvalidTokens()
    begin
        // A bare-statement Evaluate raises here instead of returning 0.
        Assert.AreEqual(0, Parser.SumOf('a;b'), 'Sum of a;b');
        Assert.AreEqual(0, Parser.CountOf('a;b'), 'Count of a;b');
    end;

    [Test]
    procedure NegativeValueAndEmptyToken()
    begin
        Assert.AreEqual(2, Parser.SumOf('-4;;6'), 'Sum of -4;;6 - the empty token contributes nothing');
        Assert.AreEqual(2, Parser.CountOf('-4;;6'), 'Count of -4;;6');
    end;

    [Test]
    procedure EmptyLog()
    begin
        Assert.AreEqual(0, Parser.SumOf(''), 'Sum of empty log');
        Assert.AreEqual(0, Parser.CountOf(''), 'Count of empty log');
    end;
}
