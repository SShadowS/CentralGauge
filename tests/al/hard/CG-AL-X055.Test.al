codeunit 88808 "CG-AL-X055 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure MakeItems(): List of [Integer]
    var
        Items: List of [Integer];
    begin
        // 5 and 7 acceptable; 0 not > 0; -3 not > 0; 5 a repeat;
        // 200 > 100; 9 acceptable.
        Items.Add(5);
        Items.Add(0);
        Items.Add(7);
        Items.Add(-3);
        Items.Add(5);
        Items.Add(200);
        Items.Add(9);
        exit(Items);
    end;

    local procedure Render(Values: List of [Integer]): Text
    var
        Value: Integer;
        Result: Text;
    begin
        foreach Value in Values do begin
            if Result <> '' then
                Result += ',';
            Result += Format(Value);
        end;
        exit(Result);
    end;

    [Test]
    procedure CollectKeepsOnlyAcceptableItemsInOrder()
    var
        Runner: Codeunit "CG X055 Runner";
    begin
        Assert.AreEqual(
            '5,7,9',
            Render(Runner.Collect(MakeItems())),
            'Collect must return only items that are > 0, <= 100 and not repeats, in input order');
    end;

    [Test]
    procedure CollectExcludesEachRejectionReasonIndividually()
    var
        Runner: Codeunit "CG X055 Runner";
        Items: List of [Integer];
    begin
        Items.Add(0);
        Assert.AreEqual('', Render(Runner.Collect(Items)), 'Zero is not greater than zero');

        Clear(Items);
        Items.Add(-3);
        Assert.AreEqual('', Render(Runner.Collect(Items)), 'A negative item is not greater than zero');

        Clear(Items);
        Items.Add(101);
        Assert.AreEqual('', Render(Runner.Collect(Items)), 'An item greater than 100 is not acceptable');

        Clear(Items);
        Items.Add(4);
        Items.Add(4);
        Assert.AreEqual('4', Render(Runner.Collect(Items)), 'A repeated item is kept only on first appearance');
    end;

    [Test]
    procedure CollectAcceptsTheBoundaryValues()
    var
        Runner: Codeunit "CG X055 Runner";
        Items: List of [Integer];
    begin
        Items.Add(1);
        Items.Add(100);
        Assert.AreEqual('1,100', Render(Runner.Collect(Items)), '1 and 100 are both acceptable');
    end;

    [Test]
    procedure StateReflectsTheControlProcedures()
    var
        Runner: Codeunit "CG X055 Runner";
    begin
        Assert.AreEqual(0, Runner.State(), 'State is 0 before Start');
        Runner.Start();
        Assert.AreEqual(1, Runner.State(), 'Start sets the state to 1');
        Runner.Continue();
        Assert.AreEqual(2, Runner.State(), 'Continue sets the state to 2');
        Runner.Stop();
        Assert.AreEqual(0, Runner.State(), 'Stop sets the state to 0');
    end;

    [Test]
    procedure CollectLeavesTheStateUnchanged()
    var
        Runner: Codeunit "CG X055 Runner";
    begin
        Runner.Start();
        Runner.Collect(MakeItems());
        Assert.AreEqual(1, Runner.State(), 'Collect must leave the state as Start left it');
    end;
}
