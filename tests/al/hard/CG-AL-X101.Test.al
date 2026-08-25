codeunit 89295 "CG-AL-X101 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (measured
    // 2026-08-20, SOAP runner), so every test clears the ledger before seeding
    // its own rows.

    local procedure SeedEntry(EntryNo: Integer; AccountNo: Code[20]; PostingDate: Date; Amount: Decimal; EntryDescription: Text[100])
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry."Entry No." := EntryNo;
        LedgerEntry."Account No." := AccountNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry.Description := EntryDescription;
        LedgerEntry.Insert();
    end;

    local procedure AssertLine(var StatementLine: Record "CG X101 Statement Line" temporary; LineNo: Integer; ExpectedEntryNo: Integer; ExpectedDescription: Text[100]; ExpectedRunningBalance: Decimal; LineLabel: Text)
    begin
        Assert.IsTrue(StatementLine.Get(LineNo), StrSubstNo('Expected the statement to have a line with "Line No." %1 (%2)', LineNo, LineLabel));
        Assert.AreEqual(ExpectedEntryNo, StatementLine."Entry No.", StrSubstNo('Expected the %1 to reference entry no. %2', LineLabel, ExpectedEntryNo));
        Assert.AreEqual(ExpectedDescription, StatementLine.Description, StrSubstNo('Expected the %1 to be the entry described "%2"', LineLabel, ExpectedDescription));
        Assert.AreEqual(ExpectedRunningBalance, StatementLine."Running Balance", StrSubstNo('Expected the %1''s running balance to be %2', LineLabel, ExpectedRunningBalance));
    end;

    local procedure VerifyStatementInvariants(AccountNo: Code[20]; var StatementLine: Record "CG X101 Statement Line" temporary)
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        ExpectedTotal: Decimal;
        PrevBalance: Decimal;
        PrevAmount: Decimal;
        PrevDate: Date;
        PrevEntryNo: Integer;
        LineIndex: Integer;
    begin
        StatementLine.Reset();
        LedgerEntry.SetRange("Account No.", AccountNo);
        if LedgerEntry.FindSet() then
            repeat
                ExpectedTotal += LedgerEntry.Amount;
            until LedgerEntry.Next() = 0;
        Assert.AreEqual(LedgerEntry.Count(), StatementLine.Count(), 'Expected exactly one statement line per entry on the requested account');

        if StatementLine.FindSet() then
            repeat
                LineIndex += 1;
                Assert.AreEqual(LineIndex, StatementLine."Line No.", 'Expected statement line numbers to run 1, 2, 3, ... from the top without gaps');
                Assert.IsTrue(LedgerEntry.Get(StatementLine."Entry No."), StrSubstNo('Expected line %1 to reference an existing ledger entry, got entry no. %2', LineIndex, StatementLine."Entry No."));
                Assert.AreEqual(AccountNo, LedgerEntry."Account No.", StrSubstNo('Expected line %1 to belong to the requested account', LineIndex));
                Assert.AreEqual(LedgerEntry."Posting Date", StatementLine."Posting Date", StrSubstNo('Expected line %1 to copy the posting date of its entry', LineIndex));
                Assert.AreEqual(LedgerEntry.Amount, StatementLine.Amount, StrSubstNo('Expected line %1 to copy the amount of its entry', LineIndex));
                Assert.AreEqual(LedgerEntry.Description, StatementLine.Description, StrSubstNo('Expected line %1 to copy the description of its entry', LineIndex));
                if LineIndex = 1 then
                    Assert.AreEqual(ExpectedTotal, StatementLine."Running Balance", 'Expected the top line''s running balance to equal the account''s total across all its entries')
                else begin
                    Assert.IsTrue(
                        (StatementLine."Posting Date" < PrevDate) or
                        ((StatementLine."Posting Date" = PrevDate) and (StatementLine."Entry No." < PrevEntryNo)),
                        StrSubstNo('Expected newest-first order: line %1 must be older than the line above it', LineIndex));
                    Assert.AreEqual(PrevBalance - PrevAmount, StatementLine."Running Balance", StrSubstNo('Expected the running balance on line %1 to be the line above''s balance minus the line above''s amount', LineIndex));
                end;
                PrevBalance := StatementLine."Running Balance";
                PrevAmount := StatementLine.Amount;
                PrevDate := StatementLine."Posting Date";
                PrevEntryNo := StatementLine."Entry No.";
            until StatementLine.Next() = 0;
        if LineIndex > 0 then
            Assert.AreEqual(PrevAmount, PrevBalance, 'Expected the bottom line''s running balance to equal its own amount, since nothing older exists');
    end;

    [Test]
    procedure RecordEntryPersistsAllFields()
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        EntryNo: Integer;
    begin
        LedgerEntry.DeleteAll();

        EntryNo := StatementBuilder.RecordEntry('ACC-T1', DMY2Date(5, 3, 2026), 250.75, 'Opening deposit');

        Assert.IsTrue(LedgerEntry.Get(EntryNo), 'Expected RecordEntry to insert a ledger entry under the entry number it returned');
        Assert.AreEqual('ACC-T1', LedgerEntry."Account No.", 'Expected the recorded entry to store the account number it was called with');
        Assert.AreEqual(DMY2Date(5, 3, 2026), LedgerEntry."Posting Date", 'Expected the recorded entry to store the posting date it was called with');
        Assert.AreEqual(250.75, LedgerEntry.Amount, 'Expected the recorded entry to store the amount it was called with');
        Assert.AreEqual('Opening deposit', LedgerEntry.Description, 'Expected the recorded entry to store the description it was called with');
    end;

    [Test]
    procedure EntryNumbersFormOneSequenceAcrossAccounts()
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
        ThirdEntryNo: Integer;
    begin
        LedgerEntry.DeleteAll();

        FirstEntryNo := StatementBuilder.RecordEntry('ACC-T2A', DMY2Date(1, 2, 2026), 10.00, 'First');
        SecondEntryNo := StatementBuilder.RecordEntry('ACC-T2B', DMY2Date(2, 2, 2026), 20.00, 'Second');
        ThirdEntryNo := StatementBuilder.RecordEntry('ACC-T2A', DMY2Date(3, 2, 2026), 30.00, 'Third');

        Assert.AreEqual(1, FirstEntryNo, 'Expected the first entry recorded into an empty ledger to get entry number 1');
        Assert.AreEqual(2, SecondEntryNo, 'Expected the second recorded entry to get entry number 2, the sequence shared across accounts');
        Assert.AreEqual(3, ThirdEntryNo, 'Expected the third recorded entry to get entry number 3, the sequence shared across accounts');
    end;

    [Test]
    procedure NextEntryNumberFollowsHighestExisting()
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        EntryNo: Integer;
    begin
        LedgerEntry.DeleteAll();
        SeedEntry(40, 'ACC-T3', DMY2Date(1, 1, 2026), 5.00, 'Imported entry');

        EntryNo := StatementBuilder.RecordEntry('ACC-T3', DMY2Date(2, 1, 2026), 10.00, 'New entry');

        Assert.AreEqual(41, EntryNo, 'Expected the next entry number to be one greater than the highest existing entry number, not counted from the number of rows');
    end;

    [Test]
    procedure StatementListsNewestFirstWhenRecordedInOrder()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedEntry(10, 'ACC-T4', DMY2Date(3, 1, 2026), 80.00, 'Oldest');
        SeedEntry(11, 'ACC-T4', DMY2Date(15, 1, 2026), 50.00, 'Middle');
        SeedEntry(12, 'ACC-T4', DMY2Date(28, 1, 2026), 20.00, 'Newest');

        StatementBuilder.BuildStatement('ACC-T4', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(), 'Expected one statement line per entry on the account');
        AssertLine(StatementLine, 1, 12, 'Newest', 150.00, 'top line');
        AssertLine(StatementLine, 2, 11, 'Middle', 130.00, 'middle line');
        AssertLine(StatementLine, 3, 10, 'Oldest', 80.00, 'bottom line');
    end;

    [Test]
    procedure StatementOrdersByPostingDateWhenRecordedOutOfOrder()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedEntry(1, 'ACC-T5', DMY2Date(20, 1, 2026), 50.00, 'A1');
        SeedEntry(2, 'ACC-T5', DMY2Date(5, 1, 2026), 30.00, 'A2');
        SeedEntry(3, 'ACC-T5', DMY2Date(12, 1, 2026), 20.00, 'A3');

        StatementBuilder.BuildStatement('ACC-T5', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(), 'Expected one statement line per entry on the account');
        AssertLine(StatementLine, 1, 1, 'A1', 100.00, 'top line (latest posting date)');
        AssertLine(StatementLine, 2, 3, 'A3', 50.00, 'middle line');
        AssertLine(StatementLine, 3, 2, 'A2', 30.00, 'bottom line (earliest posting date)');
    end;

    [Test]
    procedure SameDayEntriesBreakTheTieByEntryNo()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedEntry(7, 'ACC-T6', DMY2Date(10, 2, 2026), 10.00, 'Morning');
        SeedEntry(8, 'ACC-T6', DMY2Date(10, 2, 2026), 5.00, 'Afternoon');

        StatementBuilder.BuildStatement('ACC-T6', StatementLine);

        StatementLine.Reset();
        AssertLine(StatementLine, 1, 8, 'Afternoon', 15.00, 'top line (later same-day entry)');
        AssertLine(StatementLine, 2, 7, 'Morning', 10.00, 'bottom line (earlier same-day entry)');
    end;

    [Test]
    procedure StatementIsolatesEntriesByAccount()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedEntry(1, 'ACC-T7A', DMY2Date(20, 1, 2026), 100.00, 'A newer');
        SeedEntry(2, 'ACC-T7B', DMY2Date(3, 1, 2026), 999.00, 'B noise 1');
        SeedEntry(3, 'ACC-T7A', DMY2Date(5, 1, 2026), 40.00, 'A older');
        SeedEntry(4, 'ACC-T7B', DMY2Date(25, 1, 2026), 999.00, 'B noise 2');

        StatementBuilder.BuildStatement('ACC-T7A', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(2, StatementLine.Count(), 'Expected only the requested account''s entries on the statement');
        AssertLine(StatementLine, 1, 1, 'A newer', 140.00, 'top line');
        AssertLine(StatementLine, 2, 3, 'A older', 40.00, 'bottom line');

        Assert.IsTrue(LedgerEntry.Get(2), 'Expected the other account''s entry to remain in the ledger, untouched');
        Assert.AreEqual(999.00, LedgerEntry.Amount, 'Expected the other account''s entry to keep its original amount');
        Assert.IsTrue(LedgerEntry.Get(4), 'Expected the other account''s entry to remain in the ledger, untouched');
        Assert.AreEqual(999.00, LedgerEntry.Amount, 'Expected the other account''s entry to keep its original amount');
    end;

    [Test]
    procedure RebuildReplacesTheWholeStatementWhateverTheCallerWasViewing()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedEntry(1, 'ACC-T8A', DMY2Date(4, 1, 2026), 10.00, 'A one');
        SeedEntry(2, 'ACC-T8A', DMY2Date(6, 1, 2026), 20.00, 'A two');
        SeedEntry(3, 'ACC-T8B', DMY2Date(8, 1, 2026), 5.00, 'B only');
        StatementBuilder.BuildStatement('ACC-T8A', StatementLine);
        // The caller is left looking at a narrowed view of its own buffer. A
        // rebuild must still replace the whole statement, not just the part
        // the caller happened to have in view.
        StatementLine.SetRange("Line No.", 1, 1);

        StatementBuilder.BuildStatement('ACC-T8B', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected BuildStatement to empty the buffer before filling it, so lines from the previous statement do not survive a rebuild');
        AssertLine(StatementLine, 1, 3, 'B only', 5.00, 'rebuilt line');
    end;

    [Test]
    procedure AccountWithNoEntriesYieldsEmptyStatement()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedEntry(1, 'ACC-T9OTHER', DMY2Date(5, 1, 2026), 50.00, 'Noise');

        StatementBuilder.BuildStatement('ACC-T9', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(0, StatementLine.Count(), 'Expected an account with no entries to produce an empty statement');
    end;

    [Test]
    procedure RandomizedLedgerKeepsEveryGuarantee()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
        Any: Codeunit Any;
        i: Integer;
    begin
        LedgerEntry.DeleteAll();
        Any.SetSeed(101);
        for i := 1 to 8 do
            SeedEntry(i, 'ACC-T10', Any.DateInRange(DMY2Date(1, 1, 2026), 1, 40), (Any.IntegerInRange(1, 100000) - 50000) / 100, StrSubstNo('Random %1', i));
        SeedEntry(9, 'ACC-T10X', DMY2Date(15, 1, 2026), 77.77, 'Decoy');
        SeedEntry(10, 'ACC-T10X', DMY2Date(25, 1, 2026), -13.13, 'Decoy');

        StatementBuilder.BuildStatement('ACC-T10', StatementLine);

        VerifyStatementInvariants('ACC-T10', StatementLine);
    end;
}
