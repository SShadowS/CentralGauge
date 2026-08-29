codeunit 89386 "CG-AL-X166 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the persisted tables before seeding its own rows.
    // "CG X166 Statement Line" is a caller-owned temporary buffer (never
    // persisted) and needs no clearing between tests.

    local procedure ClearAll()
    var
        Account: Record "CG X166 Account";
        LedgerEntry: Record "CG X166 Ledger Entry";
    begin
        Account.DeleteAll();
        LedgerEntry.DeleteAll();
    end;

    local procedure SeedAccount(AccountNo: Code[20]; AccountName: Text[100])
    var
        Account: Record "CG X166 Account";
    begin
        Account.Init();
        Account."No." := AccountNo;
        Account.Name := AccountName;
        // Nonzero sentinel: an account that is never rebuilt must keep this
        // exactly, and a rebuilt account must overwrite it.
        Account."Closing Balance" := -999;
        Account.Insert();
    end;

    local procedure SeedEntry(AccountNo: Code[20]; PostingDate: Date; EntryAmount: Decimal): Integer
    var
        LedgerEntry: Record "CG X166 Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Account No." := AccountNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := EntryAmount;
        LedgerEntry.Insert(true);
        exit(LedgerEntry."Entry No.");
    end;

    local procedure MaxStatements(): Integer
    begin
        exit(60);
    end;

    local procedure MaxRows(): Integer
    begin
        exit(700);
    end;

    [Test]
    procedure RebuildStatementComputesTheRunningBalanceAfterEachEntry()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        E1: Integer;
        E2: Integer;
        E3: Integer;
        E4: Integer;
    begin
        ClearAll();
        SeedAccount('ACC-1', 'Acme Holdings');
        E1 := SeedEntry('ACC-1', DMY2Date(1, 1, 2024), 100);
        E2 := SeedEntry('ACC-1', DMY2Date(2, 1, 2024), -30);
        E3 := SeedEntry('ACC-1', DMY2Date(3, 1, 2024), 50);
        E4 := SeedEntry('ACC-1', DMY2Date(4, 1, 2024), 20);

        Builder.RebuildStatement('ACC-1', StatementLine);

        StatementLine.Get('ACC-1', E1);
        Assert.AreEqual(100.0, StatementLine."Running Balance",
            'Expected the balance after the first posting to equal that posting''s amount');
        Assert.AreEqual(100.0, StatementLine.Amount,
            'Expected the posting''s own amount to carry through to its statement line unchanged');

        StatementLine.Get('ACC-1', E2);
        Assert.AreEqual(70.0, StatementLine."Running Balance",
            'Expected the balance after the second posting to reflect both postings so far');
        Assert.AreEqual(-30.0, StatementLine.Amount,
            'Expected a negative posting''s own amount to carry through unchanged');

        StatementLine.Get('ACC-1', E3);
        Assert.AreEqual(120.0, StatementLine."Running Balance",
            'Expected the balance after the third posting to reflect all postings so far');

        StatementLine.Get('ACC-1', E4);
        Assert.AreEqual(140.0, StatementLine."Running Balance",
            'Expected the balance after the last posting to reflect every posting on the account');
    end;

    [Test]
    procedure ABackdatedPostingLandsInDateOrderNotInTheOrderItWasEntered()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        ELate: Integer;
        EEarly: Integer;
    begin
        ClearAll();
        SeedAccount('ACC-8', 'Backdated Corp');
        ELate := SeedEntry('ACC-8', DMY2Date(10, 1, 2024), 100);
        EEarly := SeedEntry('ACC-8', DMY2Date(1, 1, 2024), 10);

        Builder.RebuildStatement('ACC-8', StatementLine);

        StatementLine.Get('ACC-8', EEarly);
        Assert.AreEqual(10.0, StatementLine."Running Balance",
            'Expected the earlier-dated posting to carry only its own amount, even though it was entered last');
        StatementLine.Get('ACC-8', ELate);
        Assert.AreEqual(110.0, StatementLine."Running Balance",
            'Expected the later-dated posting to carry both postings, even though it was entered first');
    end;

    [Test]
    procedure SameDatePostingsAreOrderedByEntrySequence()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        E0: Integer;
        EA: Integer;
        EB: Integer;
        EC: Integer;
    begin
        ClearAll();
        SeedAccount('ACC-2', 'Beta Corp');
        E0 := SeedEntry('ACC-2', DMY2Date(31, 12, 2023), 1000);
        EA := SeedEntry('ACC-2', DMY2Date(1, 1, 2024), 10);
        EB := SeedEntry('ACC-2', DMY2Date(1, 1, 2024), 5);
        EC := SeedEntry('ACC-2', DMY2Date(1, 1, 2024), 3);

        Builder.RebuildStatement('ACC-2', StatementLine);

        StatementLine.Get('ACC-2', E0);
        Assert.AreEqual(1000.0, StatementLine."Running Balance",
            'Expected the balance after the earliest posting to equal that posting''s own amount');
        StatementLine.Get('ACC-2', EA);
        Assert.AreEqual(1010.0, StatementLine."Running Balance",
            'Expected the first of three same-day postings to only include postings up to itself');
        StatementLine.Get('ACC-2', EB);
        Assert.AreEqual(1015.0, StatementLine."Running Balance",
            'Expected the second of three same-day postings to include only itself and the ones before it');
        StatementLine.Get('ACC-2', EC);
        Assert.AreEqual(1018.0, StatementLine."Running Balance",
            'Expected the last of three same-day postings to include every posting on the account');
    end;

    [Test]
    procedure NegativeAmountsCanCarryTheBalanceBelowZero()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        E1: Integer;
        E2: Integer;
        E3: Integer;
    begin
        ClearAll();
        SeedAccount('ACC-3', 'Gamma Ltd');
        E1 := SeedEntry('ACC-3', DMY2Date(1, 1, 2024), -40);
        E2 := SeedEntry('ACC-3', DMY2Date(2, 1, 2024), 15);
        E3 := SeedEntry('ACC-3', DMY2Date(3, 1, 2024), 50);

        Builder.RebuildStatement('ACC-3', StatementLine);

        StatementLine.Get('ACC-3', E1);
        Assert.AreEqual(-40.0, StatementLine."Running Balance",
            'Expected the balance to go negative after a posting that overdraws the account');
        StatementLine.Get('ACC-3', E2);
        Assert.AreEqual(-25.0, StatementLine."Running Balance",
            'Expected the balance to stay negative while still owing more than the new posting covers');
        StatementLine.Get('ACC-3', E3);
        Assert.AreEqual(25.0, StatementLine."Running Balance",
            'Expected the balance to cross back above zero once postings recover the deficit');
        Assert.AreEqual(25.0, Builder.ClosingBalanceOf('ACC-3'),
            'Expected the closing balance to match the balance after the last posting');
    end;

    [Test]
    procedure RebuildingASecondAccountIntoTheSameBufferKeepsTheFirstAccountsLines()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Account: Record "CG X166 Account";
        Builder: Codeunit "CG X166 Statement Builder";
        A1: Integer;
        A2: Integer;
        B1: Integer;
    begin
        ClearAll();
        SeedAccount('ACC-4A', 'Delta');
        SeedAccount('ACC-4B', 'Epsilon');
        A1 := SeedEntry('ACC-4A', DMY2Date(1, 1, 2024), 10);
        A2 := SeedEntry('ACC-4A', DMY2Date(2, 1, 2024), 5);
        B1 := SeedEntry('ACC-4B', DMY2Date(1, 1, 2024), 100);

        Builder.RebuildStatement('ACC-4A', StatementLine);

        StatementLine.Get('ACC-4A', A1);
        Assert.AreEqual(10.0, StatementLine."Running Balance",
            'Expected the rebuilt account''s own first posting to be correct');
        StatementLine.Get('ACC-4A', A2);
        Assert.AreEqual(15.0, StatementLine."Running Balance",
            'Expected the rebuilt account''s own second posting to be correct');
        Assert.AreEqual(15.0, Builder.ClosingBalanceOf('ACC-4A'),
            'Expected the rebuilt account''s closing balance to match its own postings');
        Account.Get('ACC-4B');
        Assert.AreEqual(-999.0, Account."Closing Balance",
            'Expected an account that was never rebuilt to keep the closing balance it already had');

        // Rebuild a SECOND account into the SAME buffer: this must add that
        // account's own lines without disturbing the first account's lines
        // already sitting in the buffer, and must not pull the first
        // account's postings into the second account's lines either.
        Builder.RebuildStatement('ACC-4B', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(),
            'Expected the shared buffer to hold both accounts'' lines after rebuilding each once');
        StatementLine.Get('ACC-4A', A1);
        Assert.AreEqual(10.0, StatementLine."Running Balance",
            'Expected the first account''s earlier line to survive unchanged after rebuilding a second account into the same buffer');
        StatementLine.Get('ACC-4A', A2);
        Assert.AreEqual(15.0, StatementLine."Running Balance",
            'Expected the first account''s later line to survive unchanged after rebuilding a second account into the same buffer');
        StatementLine.Get('ACC-4B', B1);
        Assert.AreEqual(100.0, StatementLine."Running Balance",
            'Expected the second account''s own line to be correct and not mixed with the first account''s postings');
        Assert.AreEqual(100.0, Builder.ClosingBalanceOf('ACC-4B'),
            'Expected the second account''s closing balance to match only its own postings');
    end;

    [Test]
    procedure RebuildingAgainAfterANewPostingKeepsEarlierLinesCorrect()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        E1: Integer;
        E2: Integer;
    begin
        ClearAll();
        SeedAccount('ACC-5', 'Zeta');
        E1 := SeedEntry('ACC-5', DMY2Date(1, 1, 2024), 7);
        Builder.RebuildStatement('ACC-5', StatementLine);

        StatementLine.SetRange("Account No.", 'ACC-5');
        Assert.AreEqual(1, StatementLine.Count(),
            'Expected exactly one statement line after the first rebuild with one posting');

        E2 := SeedEntry('ACC-5', DMY2Date(2, 1, 2024), 3);
        Builder.RebuildStatement('ACC-5', StatementLine);

        StatementLine.SetRange("Account No.", 'ACC-5');
        Assert.AreEqual(2, StatementLine.Count(),
            'Expected the rebuilt statement to include the posting added since the last rebuild, not accumulate duplicates');
        StatementLine.Get('ACC-5', E1);
        Assert.AreEqual(7.0, StatementLine."Running Balance",
            'Expected the earlier posting''s line to still be correct after a rebuild, not stale or dropped');
        StatementLine.Get('ACC-5', E2);
        Assert.AreEqual(10.0, StatementLine."Running Balance",
            'Expected the newly added posting to appear with the correct running balance after a rebuild');
        Assert.AreEqual(10.0, Builder.ClosingBalanceOf('ACC-5'),
            'Expected the closing balance to follow the rebuilt statement''s last line');
    end;

    [Test]
    procedure RebuildingAnAccountWithNoPostingsClearsItsStatementAndZeroesTheBalance()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
    begin
        ClearAll();
        SeedAccount('ACC-6', 'Eta');

        Builder.RebuildStatement('ACC-6', StatementLine);

        StatementLine.SetRange("Account No.", 'ACC-6');
        Assert.AreEqual(0, StatementLine.Count(),
            'Expected an account with no postings at all to end up with no statement lines');
        Assert.AreEqual(0.0, Builder.ClosingBalanceOf('ACC-6'),
            'Expected an account with no postings to have a closing balance of zero');
    end;

    [Test]
    procedure RebuildingAfterAllPostingsAreRemovedClearsTheStatement()
    var
        LedgerEntry: Record "CG X166 Ledger Entry";
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        E1: Integer;
        E2: Integer;
    begin
        ClearAll();
        SeedAccount('ACC-6B', 'Theta');
        E1 := SeedEntry('ACC-6B', DMY2Date(1, 1, 2024), 4);
        E2 := SeedEntry('ACC-6B', DMY2Date(2, 1, 2024), 6);
        Builder.RebuildStatement('ACC-6B', StatementLine);

        StatementLine.SetRange("Account No.", 'ACC-6B');
        Assert.AreEqual(2, StatementLine.Count(),
            'Expected two statement lines before any postings are removed');

        LedgerEntry.Get(E1);
        LedgerEntry.Delete();
        LedgerEntry.Get(E2);
        LedgerEntry.Delete();
        Builder.RebuildStatement('ACC-6B', StatementLine);

        StatementLine.SetRange("Account No.", 'ACC-6B');
        Assert.AreEqual(0, StatementLine.Count(),
            'Expected a rebuild after every posting was removed to leave no statement lines behind');
        Assert.AreEqual(0.0, Builder.ClosingBalanceOf('ACC-6B'),
            'Expected a rebuild after every posting was removed to zero the closing balance');
    end;

    [Test]
    procedure TheAccountsOwnNameIsNotDisturbedByARebuild()
    var
        Account: Record "CG X166 Account";
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
    begin
        ClearAll();
        SeedAccount('ACC-7', 'Iota Group');
        SeedEntry('ACC-7', DMY2Date(1, 1, 2024), 12);

        Builder.RebuildStatement('ACC-7', StatementLine);

        // Read straight off the table, not through the accessor: the
        // closing balance is contracted to be STORED on the account, and a
        // rewrite that computes it on demand must not pass.
        Account.Get('ACC-7');
        Assert.AreEqual('Iota Group', Account.Name,
            'Expected the account''s own name to be left exactly as it was');
        Assert.AreEqual(12.0, Account."Closing Balance",
            'Expected the account to carry the closing balance its postings add up to');
    end;

    [Test]
    procedure RebuildStatementFailsForAnUnknownAccount()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
    begin
        ClearAll();

        asserterror Builder.RebuildStatement('NOPE', StatementLine);

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure ClosingBalanceOfFailsForAnUnknownAccount()
    var
        Builder: Codeunit "CG X166 Statement Builder";
    begin
        ClearAll();

        asserterror Builder.ClosingBalanceOf('NOPE');

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure RebuildingAnAccountWithManyPostingsCostsTheSameAsAFewPostings()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        LedgerEntry: Record "CG X166 Ledger Entry";
        WarmStatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        PostingCount: Integer;
        SeededCount: Integer;
        i: Integer;
        FirstEntryNo: Integer;
        LastEntryNo: Integer;
        ExpectedClosing: Decimal;
    begin
        ClearAll();
        PostingCount := 250;

        // Warm up on an unrelated account first, then clear it, so
        // first-touch metadata/plan loading lands outside the measured
        // window below and the warm-up's own data cannot be reused by the
        // graded call.
        SeedAccount('ACC-WARM-A', 'Warmup A');
        SeedEntry('ACC-WARM-A', DMY2Date(1, 1, 2024), 1);
        Builder.RebuildStatement('ACC-WARM-A', WarmStatementLine);
        ClearAll();

        SeedAccount('ACC-BIG-A', 'Northwind Holdings');
        ExpectedClosing := 0;
        for i := 1 to PostingCount do begin
            if i = 1 then
                FirstEntryNo := SeedEntry('ACC-BIG-A', DMY2Date(1, 1, 2024) + i, 1 + (i mod 9))
            else
                LastEntryNo := SeedEntry('ACC-BIG-A', DMY2Date(1, 1, 2024) + i, 1 + (i mod 9));
            ExpectedClosing := ExpectedClosing + 1 + (i mod 9);
        end;

        // Force the buffered seeding inserts to flush before the measured
        // window - left to itself the flush would otherwise land inside it,
        // at the first read of the ledger entry table. The count itself is
        // not asserted on; it only exists to force the read.
        LedgerEntry.SetRange("Account No.", 'ACC-BIG-A');
        SeededCount := LedgerEntry.Count();

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted();
        Builder.RebuildStatement('ACC-BIG-A', StatementLine);
        StmtAfter := SessionInformation.SqlStatementsExecuted();
        StmtDelta := StmtAfter - StmtBefore;

        StatementLine.Get('ACC-BIG-A', FirstEntryNo);
        Assert.AreEqual(2.0, StatementLine."Running Balance",
            'Expected the correct balance on the first posting before judging the rebuild''s cost');
        StatementLine.Get('ACC-BIG-A', LastEntryNo);
        Assert.AreEqual(ExpectedClosing, StatementLine."Running Balance",
            'Expected the correct balance on the last posting before judging the rebuild''s cost, even with many postings');
        Assert.AreEqual(ExpectedClosing, Builder.ClosingBalanceOf('ACC-BIG-A'),
            'Expected the correct closing balance before judging the rebuild''s cost, even with many postings');

        Assert.IsTrue(StmtDelta <= MaxStatements(),
            StrSubstNo('Expected rebuilding an account''s statement to cost the same regardless of how many postings it has: budget %1, actual %2 for %3 postings', MaxStatements(), StmtDelta, PostingCount));
    end;

    [Test]
    procedure RebuildingCostsTheSameAtADifferentPostingVolumeToo()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        LedgerEntry: Record "CG X166 Ledger Entry";
        WarmStatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        PostingCount: Integer;
        SeededCount: Integer;
        i: Integer;
        FirstEntryNo: Integer;
        LastEntryNo: Integer;
        ExpectedClosing: Decimal;
    begin
        ClearAll();
        PostingCount := 450;

        SeedAccount('ACC-WARM-B', 'Warmup B');
        SeedEntry('ACC-WARM-B', DMY2Date(1, 1, 2024), 1);
        Builder.RebuildStatement('ACC-WARM-B', WarmStatementLine);
        ClearAll();

        SeedAccount('ACC-BIG-B', 'Southridge Traders');
        ExpectedClosing := 0;
        for i := 1 to PostingCount do begin
            if i = 1 then
                FirstEntryNo := SeedEntry('ACC-BIG-B', DMY2Date(1, 1, 2024) + i, 1 + (i mod 9))
            else
                LastEntryNo := SeedEntry('ACC-BIG-B', DMY2Date(1, 1, 2024) + i, 1 + (i mod 9));
            ExpectedClosing := ExpectedClosing + 1 + (i mod 9);
        end;

        LedgerEntry.SetRange("Account No.", 'ACC-BIG-B');
        SeededCount := LedgerEntry.Count();

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted();
        Builder.RebuildStatement('ACC-BIG-B', StatementLine);
        StmtAfter := SessionInformation.SqlStatementsExecuted();
        StmtDelta := StmtAfter - StmtBefore;

        StatementLine.Get('ACC-BIG-B', FirstEntryNo);
        Assert.AreEqual(2.0, StatementLine."Running Balance",
            'Expected the correct balance on the first posting before judging the rebuild''s cost');
        StatementLine.Get('ACC-BIG-B', LastEntryNo);
        Assert.AreEqual(ExpectedClosing, StatementLine."Running Balance",
            'Expected the correct balance on the last posting before judging the rebuild''s cost, even with many postings');

        Assert.IsTrue(StmtDelta <= MaxStatements(),
            StrSubstNo('Expected rebuilding an account''s statement to cost the same regardless of how many postings it has: budget %1, actual %2 for %3 postings', MaxStatements(), StmtDelta, PostingCount));
    end;

    [Test]
    procedure RebuildingOneAccountsStatementCostsTheSameNoMatterHowManyOtherAccountsExist()
    var
        StatementLine: Record "CG X166 Statement Line" temporary;
        LedgerEntry: Record "CG X166 Ledger Entry";
        WarmStatementLine: Record "CG X166 Statement Line" temporary;
        Builder: Codeunit "CG X166 Statement Builder";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        RowsDelta: BigInteger;
        DecoyAccountNo: Code[20];
        TargetPostingCount: Integer;
        DecoyAccountCount: Integer;
        DecoyPostingsPerAccount: Integer;
        SeededCount: Integer;
        i: Integer;
        j: Integer;
        FirstEntryNo: Integer;
        LastEntryNo: Integer;
        ExpectedClosing: Decimal;
    begin
        ClearAll();
        TargetPostingCount := 250;
        DecoyAccountCount := 50;
        DecoyPostingsPerAccount := 20;

        SeedAccount('ACC-WARM-C', 'Warmup C');
        SeedEntry('ACC-WARM-C', DMY2Date(1, 1, 2024), 1);
        Builder.RebuildStatement('ACC-WARM-C', WarmStatementLine);
        ClearAll();

        // Many OTHER accounts, each with their own posting history, none of
        // which the graded call ever rebuilds - only present so a wrong
        // implementation that reads more of the ledger than its own
        // account's postings has somewhere to leak rows from.
        for i := 1 to DecoyAccountCount do begin
            DecoyAccountNo := CopyStr(StrSubstNo('ACC-DECOY-%1', i), 1, 20);
            SeedAccount(DecoyAccountNo, CopyStr(StrSubstNo('Decoy Holdings %1', i), 1, 100));
            for j := 1 to DecoyPostingsPerAccount do
                SeedEntry(DecoyAccountNo, DMY2Date(1, 1, 2024) + j, 1 + (j mod 9));
        end;

        SeedAccount('ACC-WIDE', 'Targeted Traders');
        ExpectedClosing := 0;
        for i := 1 to TargetPostingCount do begin
            if i = 1 then
                FirstEntryNo := SeedEntry('ACC-WIDE', DMY2Date(1, 1, 2024) + i, 1 + (i mod 9))
            else
                LastEntryNo := SeedEntry('ACC-WIDE', DMY2Date(1, 1, 2024) + i, 1 + (i mod 9));
            ExpectedClosing := ExpectedClosing + 1 + (i mod 9);
        end;

        LedgerEntry.SetRange("Account No.", 'ACC-WIDE');
        SeededCount := LedgerEntry.Count();

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted();
        RowsBefore := SessionInformation.SqlRowsRead();
        Builder.RebuildStatement('ACC-WIDE', StatementLine);
        StmtAfter := SessionInformation.SqlStatementsExecuted();
        RowsAfter := SessionInformation.SqlRowsRead();
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        StatementLine.Get('ACC-WIDE', FirstEntryNo);
        Assert.AreEqual(2.0, StatementLine."Running Balance",
            'Expected the correct balance on the first posting before judging the rebuild''s cost');
        StatementLine.Get('ACC-WIDE', LastEntryNo);
        Assert.AreEqual(ExpectedClosing, StatementLine."Running Balance",
            'Expected the correct balance on the last posting before judging the rebuild''s cost, with many other accounts present');
        Assert.AreEqual(ExpectedClosing, Builder.ClosingBalanceOf('ACC-WIDE'),
            'Expected the correct closing balance before judging the rebuild''s cost, with many other accounts present');

        Assert.IsTrue(StmtDelta <= MaxStatements(),
            StrSubstNo('Expected rebuilding one account''s statement to cost the same regardless of how many other accounts exist: budget %1, actual %2', MaxStatements(), StmtDelta));
        Assert.IsTrue(RowsDelta <= MaxRows(),
            StrSubstNo('Expected rebuilding one account''s statement to read about as many postings as that account has, not every posting on every account: budget %1, actual %2 for %3 of its own postings among %4 postings total', MaxRows(), RowsDelta, TargetPostingCount, TargetPostingCount + DecoyAccountCount * DecoyPostingsPerAccount));
    end;
}
