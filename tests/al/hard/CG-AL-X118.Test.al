codeunit 89312 "CG-AL-X118 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears all three
    // tables before seeding its own rows.

    local procedure ClearAllData()
    var
        JournalLine: Record "CG X118 Journal Line";
        Account: Record "CG X118 Account";
        Currency: Record "CG X118 Currency";
    begin
        JournalLine.DeleteAll();
        Account.DeleteAll();
        Currency.DeleteAll();
    end;

    local procedure SeedCurrency(CurrencyCode: Code[10]; RoundingPrecision: Decimal)
    var
        Currency: Record "CG X118 Currency";
    begin
        Currency.Init();
        Currency."Code" := CurrencyCode;
        Currency."Rounding Precision" := RoundingPrecision;
        Currency.Insert();
    end;

    local procedure SeedAccount(AccountNo: Code[20]; CurrencyCode: Code[10])
    var
        Account: Record "CG X118 Account";
    begin
        Account.Init();
        Account."No." := AccountNo;
        Account."Currency Code" := CurrencyCode;
        Account.Insert();
    end;

    local procedure CreateLine(var JournalLine: Record "CG X118 Journal Line"; EntryNo: Integer; AccountNo: Code[20])
    begin
        JournalLine.Init();
        JournalLine."Entry No." := EntryNo;
        JournalLine.Insert(true);
        JournalLine.Validate("Account No.", AccountNo);
        JournalLine.Modify(true);
    end;

    local procedure SetAmountThenCounterAccount(var JournalLine: Record "CG X118 Journal Line"; AmountValue: Decimal; CounterAccountNo: Code[20])
    begin
        JournalLine.Validate(Amount, AmountValue);
        JournalLine.Validate("Counter Account No.", CounterAccountNo);
        JournalLine.Modify(true);
    end;

    // Re-reads the entry from the table and checks all three facts a
    // balanced entry must satisfy: the recorded amount is exactly what was
    // entered (never itself adjusted), the balancing amount is its exact
    // opposite, and the two therefore net to exactly zero - so a rewrite
    // that "balances" by adjusting Amount instead of Balancing Amount, or
    // by zeroing both, cannot pass alongside a genuine fix.
    local procedure AssertBalances(EntryNo: Integer; ExpectedAmount: Decimal)
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        JournalLine.Get(EntryNo);
        Assert.AreEqual(
          ExpectedAmount, JournalLine.Amount,
          StrSubstNo('Expected journal entry %1 to keep its recorded amount unchanged', EntryNo));
        Assert.AreEqual(
          -ExpectedAmount, JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s balancing amount to be the exact opposite of its amount', EntryNo));
        Assert.AreEqual(
          0.0, JournalLine.Amount + JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s amount and balancing amount to net to exactly zero', EntryNo));
    end;

    [Test]
    procedure SameCurrencyOnBothAccountsBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-EUR', 'EUR');
        CreateLine(JournalLine, 1, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 250.75, 'CTR-EUR');

        AssertBalances(1, 250.75);
        JournalLine.Get(1);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure DifferentCurrenciesWithMatchingPrecisionBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('USD', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-USD', 'USD');
        CreateLine(JournalLine, 2, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 312.40, 'CTR-USD');

        AssertBalances(2, 312.40);
    end;

    [Test]
    procedure AWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 3, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        AssertBalances(3, 100.50);
        JournalLine.Get(3);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure ASmallRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 4, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.01, 'CTR-JPY');

        AssertBalances(4, 100.01);
    end;

    [Test]
    procedure AFractionalCentRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        // 100.005 is not itself a whole number of EUR cents, but it is what
        // this account's own line already carries - the fix must preserve
        // it exactly, not round it to the nearest cent along the way.
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 15, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.005, 'CTR-JPY');

        AssertBalances(15, 100.005);
    end;

    [Test]
    procedure AWholeAmountAgainstAWholeUnitCounterCurrencyBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 5, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.00, 'CTR-JPY');

        AssertBalances(5, 100.00);
    end;

    [Test]
    procedure AFinerCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('KWD', 0.001);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-KWD', 'KWD');
        CreateLine(JournalLine, 6, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-KWD');

        AssertBalances(6, 100.50);
    end;

    [Test]
    procedure AFinelyDenominatedMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('KWD', 0.001);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-KWD', 'KWD');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 7, 'MAIN-KWD');

        SetAmountThenCounterAccount(JournalLine, 45.678, 'CTR-JPY');

        AssertBalances(7, 45.678);
    end;

    [Test]
    procedure NoMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-LOCAL', '');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 8, 'MAIN-LOCAL');

        SetAmountThenCounterAccount(JournalLine, 75.60, 'CTR-JPY');

        AssertBalances(8, 75.60);
    end;

    [Test]
    procedure ClearingTheCounterAccountLeavesNothingToBalance()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 9, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        JournalLine.Validate("Counter Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(9);
        Assert.AreEqual(100.50, JournalLine.Amount,
          'Expected clearing the counter account on a journal entry to leave its recorded amount untouched');
        Assert.AreEqual(0.0, JournalLine."Balancing Amount",
          'Expected clearing the counter account on a journal entry to leave it with nothing to balance');
    end;

    [Test]
    procedure ClearingTheAccountNoAlsoClearsTheCurrencyCode()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-EUR', 'EUR');
        CreateLine(JournalLine, 16, 'MAIN-EUR');

        JournalLine.Validate("Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(16);
        Assert.AreEqual('', JournalLine."Currency Code",
          'Expected clearing the account on a journal entry to also clear its currency');

        SetAmountThenCounterAccount(JournalLine, 60.30, 'CTR-EUR');

        AssertBalances(16, 60.30);
    end;

    [Test]
    procedure AmountChangesAfterTheCounterAccountIsSetStillBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 10, 'MAIN-EUR');

        JournalLine.Validate("Counter Account No.", 'CTR-JPY');
        JournalLine.Validate(Amount, 100.50);
        JournalLine.Modify(true);

        AssertBalances(10, 100.50);

        JournalLine.Validate(Amount, 60.25);
        JournalLine.Modify(true);

        AssertBalances(10, 60.25);
    end;

    [Test]
    procedure SettingAnUnknownCounterAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        CreateLine(JournalLine, 11, 'MAIN-EUR');
        JournalLine.Validate(Amount, 100.00);
        JournalLine.Modify(true);

        asserterror JournalLine.Validate("Counter Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure SettingAnUnknownAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        JournalLine.Init();
        JournalLine."Entry No." := 12;
        JournalLine.Insert(true);

        asserterror JournalLine.Validate("Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure UnrelatedEntriesAreNeverTouched()
    var
        JournalLine: Record "CG X118 Journal Line";
        OtherLine: Record "CG X118 Journal Line";
    begin
        ClearAllData();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');

        OtherLine.Init();
        OtherLine."Entry No." := 999;
        OtherLine.Amount := 321.00;
        OtherLine."Balancing Amount" := 777.77;
        OtherLine.Insert();

        CreateLine(JournalLine, 13, 'MAIN-EUR');
        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');
        AssertBalances(13, 100.50);

        OtherLine.Get(999);
        Assert.AreEqual(777.77, OtherLine."Balancing Amount",
          'Expected a journal entry that was never revalidated in this test to keep its recorded balancing amount untouched');
        Assert.AreEqual(321.00, OtherLine.Amount,
          'Expected a journal entry that was never revalidated in this test to keep its recorded amount untouched');
    end;

    [Test]
    procedure RandomCoarseCurrencyAmountsAlwaysBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
        Any: Codeunit Any;
        EntryNo: Integer;
        AmountValue: Decimal;
        i: Integer;
    begin
        // Amounts are drawn to three decimal places - one more than EUR's
        // own 0.01 precision - so a fix that rounds to the line's own
        // currency instead of the counter's fails on essentially every
        // draw here, not just the single hand-picked case above.
        ClearAllData();
        Any.SetSeed(118);
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');

        for i := 1 to 8 do begin
            EntryNo := 100 + i;
            AmountValue := Any.IntegerInRange(1000, 999999) / 1000;
            CreateLine(JournalLine, EntryNo, 'MAIN-EUR');
            SetAmountThenCounterAccount(JournalLine, AmountValue, 'CTR-JPY');
            AssertBalances(EntryNo, AmountValue);
        end;
    end;
}
