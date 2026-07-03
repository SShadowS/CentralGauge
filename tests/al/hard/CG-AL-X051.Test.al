codeunit 80341 "CG-AL-X051 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Account: Record "CG X051 Account";
        Entry: Record "CG X051 Entry";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts on assertion
        // failure and never reaches end-of-test cleanup, which can leave
        // rows behind on the shared container.
        Account.DeleteAll();
        Entry.DeleteAll();
    end;

    local procedure SeedAccount(No: Code[20]; Weight: Integer)
    var
        Account: Record "CG X051 Account";
    begin
        Account.Init();
        Account."No." := No;
        Account.Weight := Weight;
        Account.Insert();
    end;

    local procedure SeedEntry(EntryNo: Integer; AccountNo: Code[20]; Kind: Enum "CG X051 Kind"; Amount: Integer)
    var
        Entry: Record "CG X051 Entry";
    begin
        Entry.Init();
        Entry."Entry No." := EntryNo;
        Entry."Account No." := AccountNo;
        Entry.Kind := Kind;
        Entry.Amount := Amount;
        Entry.Insert();
    end;

    local procedure AssertDecoyIntact(DecoyNo: Code[20]; ExpectedNormalBalance: Integer)
    var
        Account: Record "CG X051 Account";
        Entry: Record "CG X051 Entry";
    begin
        Account.Get(DecoyNo);
        Account.SetRange("Kind Filter", "CG X051 Kind"::Normal);
        Account.CalcFields(Balance);
        Assert.AreEqual(ExpectedNormalBalance, Account.Balance, 'The unrelated decoy account must never be part of the day-close.');

        Entry.SetRange("Account No.", DecoyNo);
        Assert.AreEqual(2, Entry.Count(), 'The unrelated decoy account must receive no new entries from CloseDay.');
    end;

    [Test]
    procedure CloseDayFingerprintMatchesSpecificationForSeedOne()
    var
        Entry: Record "CG X051 Entry";
        Closer: Codeunit "CG X051 Closer";
        Result: Integer;
    begin
        // [GIVEN] three accounts with opaque, distinct weights, each already
        // carrying its own mixed-kind, sign-mixed entries, plus an unrelated
        // decoy account that CloseDay must never touch
        ClearState();
        SeedAccount('A', 7);
        SeedAccount('B', 11);
        SeedAccount('C', 13);
        SeedAccount('Z', 5);

        SeedEntry(1, 'A', "CG X051 Kind"::Normal, 5);
        SeedEntry(2, 'A', "CG X051 Kind"::Adjustment, -2);
        SeedEntry(3, 'B', "CG X051 Kind"::Normal, 8);
        SeedEntry(4, 'B', "CG X051 Kind"::Adjustment, 3);
        SeedEntry(5, 'C', "CG X051 Kind"::Normal, -4);
        SeedEntry(6, 'C', "CG X051 Kind"::Adjustment, 6);
        SeedEntry(7, 'Z', "CG X051 Kind"::Normal, 1000);
        SeedEntry(8, 'Z', "CG X051 Kind"::Adjustment, 500);

        // [WHEN]
        Result := Closer.CloseDay();

        // [THEN] one contract-only assertion - the fingerprint mixes three
        // weighted balances, so the delta never decomposes into which
        // account or contribution went wrong
        Assert.AreEqual(1797, Result, 'Day-close fingerprint must match its specification.');

        AssertDecoyIntact('Z', 1000);

        // [THEN] settling all three accounts must have recorded exactly the
        // entries the day's ledger requires - no more, no fewer
        Entry.Reset();
        Assert.AreEqual(17, Entry.Count(), 'Day-close must record exactly the entries the ledger requires.');

        ClearState();
    end;

    [Test]
    procedure CloseDayFingerprintMatchesSpecificationForSeedTwo()
    var
        Entry: Record "CG X051 Entry";
        Closer: Codeunit "CG X051 Closer";
        Result: Integer;
    begin
        // [GIVEN] a differently-shaped, independently opaque seed set -
        // different weights, amounts, and signs than seed one
        ClearState();
        SeedAccount('A', 3);
        SeedAccount('B', 17);
        SeedAccount('C', 19);
        SeedAccount('Z', 23);

        SeedEntry(1, 'A', "CG X051 Kind"::Normal, 12);
        SeedEntry(2, 'A', "CG X051 Kind"::Adjustment, 1);
        SeedEntry(3, 'B', "CG X051 Kind"::Normal, -6);
        SeedEntry(4, 'B', "CG X051 Kind"::Adjustment, 20);
        SeedEntry(5, 'C', "CG X051 Kind"::Normal, 9);
        SeedEntry(6, 'C', "CG X051 Kind"::Adjustment, -11);
        SeedEntry(7, 'Z', "CG X051 Kind"::Normal, 777);
        SeedEntry(8, 'Z', "CG X051 Kind"::Adjustment, 333);

        // [WHEN]
        Result := Closer.CloseDay();

        // [THEN]
        Assert.AreEqual(2199, Result, 'Day-close fingerprint must match its specification.');

        AssertDecoyIntact('Z', 777);

        Entry.Reset();
        Assert.AreEqual(17, Entry.Count(), 'Day-close must record exactly the entries the ledger requires.');

        ClearState();
    end;
}
