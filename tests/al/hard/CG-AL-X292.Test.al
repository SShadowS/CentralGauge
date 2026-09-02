codeunit 89514 "CG-AL-X292 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 5 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        // (measured 2026-08-20, SOAP runner), so every test clears all three
        // tables before seeding its own rows.
        RateService: Codeunit "CG X154 Rate Service";
        SetupMgt: Codeunit "CG X154 Setup Mgt";
        StatementBuilder: Codeunit "CG X154 Statement Builder";
        // Companies are enumerated at runtime, never hardcoded, and every test
        // that touches the other company deletes what it seeded there BEFORE
        // asserting anything, then Commit()s that delete - so the cleanup is
        // durable even if a later assertion in the same test fails and raises
        // an error. A defensive clear also runs at the start of every
        // cross-company test in case a still-earlier run was aborted before it
        // could self-heal.
        // every test clears its own tables before seeding its own rows.

    // ==========================================================
    // X075 - donor CG-AL-X075
    // ==========================================================

    local procedure X075_SeedContact(ContactNo: Code[20]; CityName: Text[30]; ContactCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Contact.Init();
        Contact."No." := ContactNo;
        Contact.City := CityName;
        Contact."Credit Limit" := ContactCreditLimit;
        Contact.Insert();
    end;

    // Walks the view the submission left on the record; called repeatedly per
    // test, which also proves the list survives being iterated more than once.
    local procedure X075_CountVisits(var Contact: Record "CG X075 Contact"; ContactNo: Code[20]): Integer
    var
        Visits: Integer;
    begin
        if Contact.FindSet() then
            repeat
                if Contact."No." = ContactNo then
                    Visits += 1;
            until Contact.Next() = 0;
        exit(Visits);
    end;

    local procedure X075_AssertContactUnchanged(ContactNo: Code[20]; ExpectedCity: Text[30]; ExpectedCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Assert.IsTrue(Contact.Get(ContactNo),
            StrSubstNo('Expected contact %1 to still exist under its original number after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCity, Contact.City,
            StrSubstNo('Expected contact %1''s city to be unchanged after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCreditLimit, Contact."Credit Limit",
            StrSubstNo('Expected contact %1''s credit limit to be unchanged after building the call list', ContactNo));
    end;

    [Test]
    procedure X075_CityOnlyQualifiersAppearOnTheList()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C001', 'RIVERTON', 0);
        X075_SeedContact('C002', 'RIVERTON', 0);
        X075_SeedContact('C003', 'LAKESIDE', 0);

        CampaignCallList.BuildCallList(Contact, 'RIVERTON', 100000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C001'),
            'Expected a contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C002'),
            'Expected a second contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C003'),
            'Expected a contact outside the target city, below the credit limit, to stay off the call list');
    end;

    [Test]
    procedure X075_CreditLimitQualifiersAppearRegardlessOfCity()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C010', 'FARAWAY', 3200);
        X075_SeedContact('C011', 'FARAWAY', 1800);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 2500);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C010'),
            'Expected a contact whose credit limit clears the threshold to be on the call list even though they live outside the target city');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C011'),
            'Expected a contact below the credit-limit threshold and outside the target city to stay off the call list');
    end;

    [Test]
    procedure X075_ContactMatchingBothRulesIsVisitedOnceAlongsideCityOnlyContact()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C020', 'HARBORVIEW', 5200);
        X075_SeedContact('C021', 'HARBORVIEW', 0);
        X075_SeedContact('C022', 'MILLBROOK', 5200);

        CampaignCallList.BuildCallList(Contact, 'HARBORVIEW', 4000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C020'),
            'Expected a contact matching both rules to be visited exactly once, nobody gets called twice');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C021'),
            'Expected a contact matching only the target-city rule to be on the same list as a contact matching both rules');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C022'),
            'Expected a contact matching only the credit-limit rule to be on the same list as a contact matching both rules');
    end;

    [Test]
    procedure X075_CreditLimitThresholdBoundaryQualifiesAtExactValue()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C030', 'RIVERSIDE', 4000);
        X075_SeedContact('C031', 'RIVERSIDE', 3999.99);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 4000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C030'),
            'Expected a credit limit exactly at the threshold to qualify, the rule is at or above the threshold, not strictly above it');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C031'),
            'Expected a credit limit just below the threshold to stay off the call list');
    end;

    [Test]
    procedure X075_TargetCityMatchesTheWholeValueOnly()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C040', 'NORTH', 0);
        X075_SeedContact('C041', 'NORTHPORT', 0);

        CampaignCallList.BuildCallList(Contact, 'NORTH', 100000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C040'),
            'Expected a contact whose city exactly matches the target city to be on the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C041'),
            'Expected a contact whose city merely starts with the target city to stay off the list, the match is on the whole value');
    end;

    [Test]
    procedure X075_BuildingTheListWritesNoContacts()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C050', 'CAMPAIGNTOWN', 900);
        X075_SeedContact('C051', 'QUIETSIDE', 900);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 5000);

        Assert.AreEqual(0, X075_CountVisits(Contact, 'C051'),
            'Expected a contact matching neither rule to stay off the call list');
        X075_AssertContactUnchanged('C050', 'CAMPAIGNTOWN', 900);
        X075_AssertContactUnchanged('C051', 'QUIETSIDE', 900);
    end;

    [Test]
    procedure X075_CampaignLookupBuildsTheSameCallListThroughTheWrapper()
    var
        Contact: Record "CG X075 Contact";
        Campaign: Record "CG X075 Campaign";
        CampaignCallListMgt: Codeunit "CG X075 Campaign Call List Mgt";
    begin
        Contact.DeleteAll();
        Campaign.DeleteAll();
        X075_SeedContact('C060', 'ELM STREET', 0);
        X075_SeedContact('C061', 'MAPLE STREET', 0);

        Campaign.Init();
        Campaign."Code" := 'SPRING26';
        Campaign."Target City" := 'ELM STREET';
        Campaign."Minimum Credit Limit" := 100000;
        Campaign.Insert();

        CampaignCallListMgt.BuildCallListForCampaign(Contact, 'SPRING26');

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C060'),
            'Expected the campaign lookup to include a contact in the campaign''s target city on the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C061'),
            'Expected the campaign lookup to leave a contact in a different city off the call list');
    end;

    // ==========================================================
    // X076 - donor CG-AL-X076
    // ==========================================================

    local procedure X076_Reset()
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.DeleteAll();
    end;

    local procedure X076_EntryExists(EntryCode: Code[20]): Boolean
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        exit(LegacyAmount.Get(EntryCode));
    end;

    local procedure X076_AmountOf(EntryCode: Code[20]): Decimal
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.Get(EntryCode);
        exit(LegacyAmount.Amount);
    end;

    [Test]
    procedure X076_ParseAmountReturnsTheValueOfAValidAmountText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.AreEqual(Amount, Importer.ParseAmount(Format(Amount)),
            'Expected ParseAmount to return the decimal value of a well-formed amount text');
    end;

    [Test]
    procedure X076_ParseAmountAcceptsZero()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        Assert.AreEqual(0.0, Importer.ParseAmount('0'),
            'Expected ParseAmount to accept zero - only negative amounts are invalid');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnTextThatIsNotANumber()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        asserterror Importer.ParseAmount('X76-garbage');

        Assert.ExpectedError('''X76-garbage'' is not a valid amount');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        NegativeText: Text;
    begin
        NegativeText := Format(-Any.DecimalInRange(1, 900, 2));

        asserterror Importer.ParseAmount(NegativeText);

        Assert.ExpectedError(StrSubstNo('''%1'' is not a valid amount', NegativeText));
    end;

    [Test]
    procedure X076_TryParseAmountReturnsTrueAndTheValueForAValidText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Expected: Decimal;
        Amount: Decimal;
        FailureReason: Text;
    begin
        Expected := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.TryParseAmount(Format(Expected), Amount, FailureReason),
            'Expected TryParseAmount to return true for a well-formed amount text');
        Assert.AreEqual(Expected, Amount, 'Expected TryParseAmount to put the parsed value into Amount');
        Assert.AreEqual('', FailureReason, 'Expected an empty FailureReason after a successful conversion');
    end;

    [Test]
    procedure X076_TryParseAmountReturnsFalseWithTheReasonInsteadOfFailing()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        // No asserterror: TryParseAmount must never raise, whatever the input.
        Assert.IsFalse(Importer.TryParseAmount('X76-not-a-number', Amount, FailureReason),
            'Expected TryParseAmount to return false for text that does not parse as an amount');
        Assert.IsTrue(FailureReason.Contains('''X76-not-a-number'' is not a valid amount'),
            StrSubstNo('Expected FailureReason to carry the conversion error text, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_TryParseAmountReportsTheLatestFailure()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        Importer.TryParseAmount('X76-first-bad', Amount, FailureReason);

        Importer.TryParseAmount('X76-second-bad', Amount, FailureReason);

        Assert.IsTrue(FailureReason.Contains('X76-second-bad'),
            StrSubstNo('Expected FailureReason to describe the latest failed input, got "%1"', FailureReason));
        Assert.IsFalse(FailureReason.Contains('X76-first-bad'),
            StrSubstNo('Expected FailureReason to no longer mention the earlier failed input, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANonNumericAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD1', 'X76-not-a-number'),
            'Expected ImportLine to return false for text that does not parse as an amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD1'), 'Expected no stored entry for an amount that failed to parse');
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD2', Format(-Any.DecimalInRange(1, 900, 2))),
            'Expected ImportLine to return false for a negative amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD2'), 'Expected no stored entry for a rejected negative amount');
    end;

    [Test]
    procedure X076_ImportLineImportsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        X076_Reset();
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.ImportLine('X76-V1', Format(Amount)),
            'Expected a well-formed, non-negative amount to be reported as imported');
        Assert.IsTrue(X076_EntryExists('X76-V1'), 'Expected a stored entry for the imported line');
        Assert.AreEqual(Amount, X076_AmountOf('X76-V1'), 'Expected the stored entry to carry the parsed amount');
    end;

    [Test]
    procedure X076_ImportLineAcceptsZeroAsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsTrue(Importer.ImportLine('X76-ZERO', '0'),
            'Expected a zero amount to be reported as imported, not rejected - zero is well-formed and non-negative');
        Assert.IsTrue(X076_EntryExists('X76-ZERO'), 'Expected a stored entry for the zero-amount line');
        Assert.AreEqual(0, X076_AmountOf('X76-ZERO'), 'Expected the stored entry to carry an amount of exactly zero');
    end;

    [Test]
    procedure X076_BatchSkipsEveryBadLineAndImportsNothing()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
    begin
        X076_Reset();
        Codes.Add('X76-B1A');
        Texts.Add('X76-not-a-number');
        Codes.Add('X76-B1B');
        Texts.Add(Format(-Any.DecimalInRange(1, 900, 2)));

        Assert.AreEqual(0, Job.ImportBatch(Codes, Texts),
            'Expected a batch of only malformed or negative lines to import nothing');
        Assert.IsFalse(X076_EntryExists('X76-B1A'), 'Expected no stored entry for the malformed line');
        Assert.IsFalse(X076_EntryExists('X76-B1B'), 'Expected no stored entry for the negative line');
    end;

    [Test]
    procedure X076_BatchImportsEveryWellFormedLineAndCountsThem()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        Amount1: Decimal;
        Amount2: Decimal;
        Amount3: Decimal;
    begin
        X076_Reset();
        Amount1 := Any.DecimalInRange(1, 300, 2);
        Amount2 := Any.DecimalInRange(1, 300, 2);
        Amount3 := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B2A');
        Texts.Add(Format(Amount1));
        Codes.Add('X76-B2B');
        Texts.Add(Format(Amount2));
        Codes.Add('X76-B2C');
        Texts.Add(Format(Amount3));

        Assert.AreEqual(3, Job.ImportBatch(Codes, Texts),
            'Expected every well-formed line in the batch to be counted as imported');
        Assert.AreEqual(Amount1, X076_AmountOf('X76-B2A'), 'Expected the first line''s parsed amount to be stored');
        Assert.AreEqual(Amount2, X076_AmountOf('X76-B2B'), 'Expected the second line''s parsed amount to be stored');
        Assert.AreEqual(Amount3, X076_AmountOf('X76-B2C'), 'Expected the third line''s parsed amount to be stored');
    end;

    [Test]
    procedure X076_BatchCountsOnlyTheWellFormedLinesInAMixedBatch()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        GoodAmount: Decimal;
    begin
        X076_Reset();
        GoodAmount := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B3BAD');
        Texts.Add('X76-still-not-a-number');
        Codes.Add('X76-B3GOOD');
        Texts.Add(Format(GoodAmount));

        Assert.AreEqual(1, Job.ImportBatch(Codes, Texts),
            'Expected only the well-formed line to be counted as imported');
        Assert.IsFalse(X076_EntryExists('X76-B3BAD'), 'Expected no stored entry for the malformed line');
        Assert.IsTrue(X076_EntryExists('X76-B3GOOD'), 'Expected a stored entry for the well-formed line');
        Assert.AreEqual(GoodAmount, X076_AmountOf('X76-B3GOOD'), 'Expected the well-formed line''s parsed amount to be stored');
    end;

    // ==========================================================
    // X118 - donor CG-AL-X118
    // ==========================================================

    local procedure X118_ClearAllData()
    var
        JournalLine: Record "CG X118 Journal Line";
        Account: Record "CG X118 Account";
        Currency: Record "CG X118 Currency";
    begin
        JournalLine.DeleteAll();
        Account.DeleteAll();
        Currency.DeleteAll();
    end;

    local procedure X118_SeedCurrency(CurrencyCode: Code[10]; RoundingPrecision: Decimal)
    var
        Currency: Record "CG X118 Currency";
    begin
        Currency.Init();
        Currency."Code" := CurrencyCode;
        Currency."Rounding Precision" := RoundingPrecision;
        Currency.Insert();
    end;

    local procedure X118_SeedAccount(AccountNo: Code[20]; CurrencyCode: Code[10])
    var
        Account: Record "CG X118 Account";
    begin
        Account.Init();
        Account."No." := AccountNo;
        Account."Currency Code" := CurrencyCode;
        Account.Insert();
    end;

    local procedure X118_CreateLine(var JournalLine: Record "CG X118 Journal Line"; EntryNo: Integer; AccountNo: Code[20])
    begin
        JournalLine.Init();
        JournalLine."Entry No." := EntryNo;
        JournalLine.Insert(true);
        JournalLine.Validate("Account No.", AccountNo);
        JournalLine.Modify(true);
    end;

    local procedure X118_SetAmountThenCounterAccount(var JournalLine: Record "CG X118 Journal Line"; AmountValue: Decimal; CounterAccountNo: Code[20])
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
    local procedure X118_AssertBalances(EntryNo: Integer; ExpectedAmount: Decimal)
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
    procedure X118_SameCurrencyOnBothAccountsBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-EUR', 'EUR');
        X118_CreateLine(JournalLine, 1, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 250.75, 'CTR-EUR');

        X118_AssertBalances(1, 250.75);
        JournalLine.Get(1);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure X118_DifferentCurrenciesWithMatchingPrecisionBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('USD', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-USD', 'USD');
        X118_CreateLine(JournalLine, 2, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 312.40, 'CTR-USD');

        X118_AssertBalances(2, 312.40);
    end;

    [Test]
    procedure X118_AWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 3, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        X118_AssertBalances(3, 100.50);
        JournalLine.Get(3);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure X118_ASmallRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 4, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.01, 'CTR-JPY');

        X118_AssertBalances(4, 100.01);
    end;

    [Test]
    procedure X118_AFractionalCentRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        // 100.005 is not itself a whole number of EUR cents, but it is what
        // this account's own line already carries - the fix must preserve
        // it exactly, not round it to the nearest cent along the way.
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 15, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.005, 'CTR-JPY');

        X118_AssertBalances(15, 100.005);
    end;

    [Test]
    procedure X118_AWholeAmountAgainstAWholeUnitCounterCurrencyBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 5, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.00, 'CTR-JPY');

        X118_AssertBalances(5, 100.00);
    end;

    [Test]
    procedure X118_AFinerCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('KWD', 0.001);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-KWD', 'KWD');
        X118_CreateLine(JournalLine, 6, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-KWD');

        X118_AssertBalances(6, 100.50);
    end;

    [Test]
    procedure X118_AZeroPrecisionCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('ZPR', 0);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-ZPR', 'ZPR');
        X118_CreateLine(JournalLine, 14, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 88.37, 'CTR-ZPR');

        X118_AssertBalances(14, 88.37);
    end;

    [Test]
    procedure X118_AFinelyDenominatedMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('KWD', 0.001);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-KWD', 'KWD');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 7, 'MAIN-KWD');

        X118_SetAmountThenCounterAccount(JournalLine, 45.678, 'CTR-JPY');

        X118_AssertBalances(7, 45.678);
    end;

    [Test]
    procedure X118_NoMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-LOCAL', '');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 8, 'MAIN-LOCAL');

        X118_SetAmountThenCounterAccount(JournalLine, 75.60, 'CTR-JPY');

        X118_AssertBalances(8, 75.60);
    end;

    [Test]
    procedure X118_ClearingTheCounterAccountLeavesNothingToBalance()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 9, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        JournalLine.Validate("Counter Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(9);
        Assert.AreEqual(100.50, JournalLine.Amount,
          'Expected clearing the counter account on a journal entry to leave its recorded amount untouched');
        Assert.AreEqual(0.0, JournalLine."Balancing Amount",
          'Expected clearing the counter account on a journal entry to leave it with nothing to balance');
    end;

    [Test]
    procedure X118_ClearingTheAccountNoAlsoClearsTheCurrencyCode()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-EUR', 'EUR');
        X118_CreateLine(JournalLine, 16, 'MAIN-EUR');

        JournalLine.Validate("Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(16);
        Assert.AreEqual('', JournalLine."Currency Code",
          'Expected clearing the account on a journal entry to also clear its currency');

        X118_SetAmountThenCounterAccount(JournalLine, 60.30, 'CTR-EUR');

        X118_AssertBalances(16, 60.30);
    end;

    [Test]
    procedure X118_AmountChangesAfterTheCounterAccountIsSetStillBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 10, 'MAIN-EUR');

        JournalLine.Validate("Counter Account No.", 'CTR-JPY');
        JournalLine.Validate(Amount, 100.50);
        JournalLine.Modify(true);

        X118_AssertBalances(10, 100.50);

        JournalLine.Validate(Amount, 60.25);
        JournalLine.Modify(true);

        X118_AssertBalances(10, 60.25);
    end;

    [Test]
    procedure X118_SettingAnUnknownCounterAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_CreateLine(JournalLine, 11, 'MAIN-EUR');
        JournalLine.Validate(Amount, 100.00);
        JournalLine.Modify(true);

        asserterror JournalLine.Validate("Counter Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure X118_SettingAnUnknownAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        JournalLine.Init();
        JournalLine."Entry No." := 12;
        JournalLine.Insert(true);

        asserterror JournalLine.Validate("Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure X118_UnrelatedEntriesAreNeverTouched()
    var
        JournalLine: Record "CG X118 Journal Line";
        OtherLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');

        OtherLine.Init();
        OtherLine."Entry No." := 999;
        OtherLine.Amount := 321.00;
        OtherLine."Balancing Amount" := 777.77;
        OtherLine.Insert();

        X118_CreateLine(JournalLine, 13, 'MAIN-EUR');
        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');
        X118_AssertBalances(13, 100.50);

        OtherLine.Get(999);
        Assert.AreEqual(777.77, OtherLine."Balancing Amount",
          'Expected a journal entry that was never revalidated in this test to keep its recorded balancing amount untouched');
        Assert.AreEqual(321.00, OtherLine.Amount,
          'Expected a journal entry that was never revalidated in this test to keep its recorded amount untouched');
    end;

    [Test]
    procedure X118_RandomCoarseCurrencyAmountsAlwaysBalanceExactly()
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
        X118_ClearAllData();
        Any.SetSeed(118);
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');

        for i := 1 to 8 do begin
            EntryNo := 100 + i;
            AmountValue := Any.IntegerInRange(1000, 999999) / 1000;
            X118_CreateLine(JournalLine, EntryNo, 'MAIN-EUR');
            X118_SetAmountThenCounterAccount(JournalLine, AmountValue, 'CTR-JPY');
            X118_AssertBalances(EntryNo, AmountValue);
        end;
    end;

    // ==========================================================
    // X154 - donor CG-AL-X154
    // ==========================================================

    local procedure X154_GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure X154_ClearHomeRate()
    var
        RateSetup: Record "CG X154 Rate Setup";
    begin
        RateSetup.DeleteAll();
    end;

    local procedure X154_ClearOtherRate(OtherName: Text[30])
    var
        RateSetup: Record "CG X154 Rate Setup";
    begin
        RateSetup.ChangeCompany(OtherName);
        RateSetup.DeleteAll();
    end;

    local procedure X154_ClearHomeActivity()
    var
        Activity: Record "CG X154 Activity";
    begin
        Activity.DeleteAll();
    end;

    local procedure X154_ClearOtherActivity(OtherName: Text[30])
    var
        Activity: Record "CG X154 Activity";
    begin
        Activity.ChangeCompany(OtherName);
        Activity.DeleteAll();
    end;

    local procedure X154_ClearBoth(OtherName: Text[30])
    begin
        X154_ClearHomeRate();
        X154_ClearOtherRate(OtherName);
        X154_ClearHomeActivity();
        X154_ClearOtherActivity(OtherName);
        Commit();
    end;

    // BuildCharges prices EVERY company on the database, not just the two
    // graded below - on a container with a third company, an unconfigured
    // rate there must not make the statement itself error out. These two
    // helpers keep that container-topology detail out of the graded
    // assertions: every company gets a harmless placeholder rate, then the
    // two companies actually graded are overridden with their real values.

    local procedure X154_SeedDefaultRateInEveryCompany(DefaultRate: Decimal)
    var
        Company: Record Company;
    begin
        if Company.FindSet() then
            repeat
                SetupMgt.SetServiceRate(Company.Name, DefaultRate);
            until Company.Next() = 0;
    end;

    local procedure X154_ClearRateInEveryCompany()
    var
        Company: Record Company;
        RateSetup: Record "CG X154 Rate Setup";
    begin
        if Company.FindSet() then
            repeat
                RateSetup.ChangeCompany(Company.Name);
                RateSetup.DeleteAll();
            until Company.Next() = 0;
    end;

    [Test]
    procedure X154_TheConsolidatedStatementChargesEachCompanyAtItsOwnRate()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        Charges: Dictionary of [Text, Decimal];
        HomeCharge: Decimal;
        OtherCharge: Decimal;
    begin
        OtherName := X154_GetOtherCompanyName();
        HomeName := CompanyName();
        X154_ClearBoth(OtherName);
        X154_ClearRateInEveryCompany();
        Commit();
        RateService.Reset();

        X154_SeedDefaultRateInEveryCompany(1.0);

        SetupMgt.SetServiceRate(HomeName, 12.5);
        SetupMgt.SetActivityQuantity(HomeName, 4);
        SetupMgt.SetServiceRate(OtherName, 7.25);
        SetupMgt.SetActivityQuantity(OtherName, 10);

        Charges := StatementBuilder.BuildCharges();
        HomeCharge := Charges.Get(HomeName);
        OtherCharge := Charges.Get(OtherName);

        X154_ClearBoth(OtherName);
        X154_ClearRateInEveryCompany();
        Commit();

        Assert.AreEqual(50.0, HomeCharge,
            'Expected the home company to be charged its own quantity times its own configured rate');
        Assert.AreEqual(72.5, OtherCharge,
            'Expected the other company to be charged its own quantity times its own configured rate, not the home company''s rate');
    end;

    [Test]
    procedure X154_QueryingTheOtherCompanysRateFirstStillLeavesTheHomeCompanysRateCorrect()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        OtherRate: Decimal;
        HomeRate: Decimal;
    begin
        OtherName := X154_GetOtherCompanyName();
        HomeName := CompanyName();
        X154_ClearBoth(OtherName);
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 18.0);
        SetupMgt.SetServiceRate(OtherName, 3.5);

        OtherRate := RateService.GetServiceRate(OtherName);
        HomeRate := RateService.GetServiceRate(HomeName);

        X154_ClearBoth(OtherName);

        Assert.AreEqual(3.5, OtherRate,
            'Expected the other company''s rate to reflect what it configured for itself');
        Assert.AreEqual(18.0, HomeRate,
            'Expected the home company''s rate to reflect what it configured for itself, unaffected by having just looked up another company''s rate');
    end;

    [Test]
    procedure X154_QueryingTheHomeCompanysRateFirstStillLeavesTheOtherCompanysRateCorrect()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeRate: Decimal;
        OtherRate: Decimal;
    begin
        OtherName := X154_GetOtherCompanyName();
        HomeName := CompanyName();
        X154_ClearBoth(OtherName);
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 9.9);
        SetupMgt.SetServiceRate(OtherName, 21.0);

        HomeRate := RateService.GetServiceRate(HomeName);
        OtherRate := RateService.GetServiceRate(OtherName);

        X154_ClearBoth(OtherName);

        Assert.AreEqual(9.9, HomeRate,
            'Expected the home company''s rate to reflect what it configured for itself');
        Assert.AreEqual(21.0, OtherRate,
            'Expected the other company''s rate to reflect what it configured for itself, unaffected by having just looked up the home company''s rate');
    end;

    [Test]
    procedure X154_PricingOnlyTheHomeCompanysOwnActivityReflectsItsOwnRate()
    var
        HomeName: Text[30];
        Rate: Decimal;
    begin
        HomeName := CompanyName();
        X154_ClearHomeRate();
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 6.4);

        Rate := RateService.GetServiceRate(HomeName);

        X154_ClearHomeRate();

        Assert.AreEqual(6.4, Rate,
            'Expected the home company''s own rate lookup to reflect what it configured for itself');
    end;

    [Test]
    procedure X154_ChangingOneCompanysRateDoesNotChangeAnotherCompanysConfiguredRate()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RateSetup: Record "CG X154 Rate Setup";
        OtherRateSetup: Record "CG X154 Rate Setup";
        HomeDirect: Decimal;
        OtherDirect: Decimal;
    begin
        OtherName := X154_GetOtherCompanyName();
        HomeName := CompanyName();
        X154_ClearBoth(OtherName);

        SetupMgt.SetServiceRate(HomeName, 15.0);
        SetupMgt.SetServiceRate(OtherName, 40.0);

        HomeDirect := SetupMgt.GetServiceRateDirect(HomeName);
        OtherDirect := SetupMgt.GetServiceRateDirect(OtherName);

        RateSetup.Get('RATE');
        OtherRateSetup.ChangeCompany(OtherName);
        OtherRateSetup.Get('RATE');

        X154_ClearBoth(OtherName);

        Assert.AreEqual(15.0, HomeDirect,
            'Expected the home company''s directly configured rate to be unaffected by another company''s configured rate');
        Assert.AreEqual(40.0, OtherDirect,
            'Expected the other company''s directly configured rate to reflect what it configured for itself');
        Assert.AreEqual(15.0, RateSetup."Service Rate",
            'Expected the home company''s rate to be persisted with its own value on its own record');
        Assert.AreEqual(40.0, OtherRateSetup."Service Rate",
            'Expected the other company''s rate to be persisted with its own value on its own record');
    end;

    [Test]
    procedure X154_ChangingOneCompanysActivityQuantityDoesNotChangeAnotherCompanysQuantity()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        Activity: Record "CG X154 Activity";
        OtherActivity: Record "CG X154 Activity";
        HomeQty: Decimal;
        OtherQty: Decimal;
    begin
        OtherName := X154_GetOtherCompanyName();
        HomeName := CompanyName();
        X154_ClearBoth(OtherName);

        SetupMgt.SetActivityQuantity(HomeName, 8);
        SetupMgt.SetActivityQuantity(OtherName, 33);

        HomeQty := SetupMgt.GetActivityQuantity(HomeName);
        OtherQty := SetupMgt.GetActivityQuantity(OtherName);

        Activity.Get('ACTIVITY');
        OtherActivity.ChangeCompany(OtherName);
        OtherActivity.Get('ACTIVITY');

        X154_ClearBoth(OtherName);

        Assert.AreEqual(8.0, HomeQty,
            'Expected the home company''s activity quantity to be unaffected by another company''s activity');
        Assert.AreEqual(33.0, OtherQty,
            'Expected the other company''s activity quantity to reflect what was configured for it');
        Assert.AreEqual(8.0, Activity.Quantity,
            'Expected the home company''s activity quantity to be persisted on its own record');
        Assert.AreEqual(33.0, OtherActivity.Quantity,
            'Expected the other company''s activity quantity to be persisted on its own record');
    end;

    [Test]
    procedure X154_ACompanyThatHasNotConfiguredARateIsTreatedAsZero()
    var
        HomeName: Text[30];
        Rate: Decimal;
    begin
        HomeName := CompanyName();
        X154_ClearHomeRate();

        Rate := SetupMgt.GetServiceRateDirect(HomeName);

        Assert.AreEqual(0.0, Rate,
            'Expected no configured rate to read as zero rather than an arbitrary leftover value');
    end;

    [Test]
    procedure X154_ACompanyThatHasNotConfiguredActivityIsTreatedAsZero()
    var
        HomeName: Text[30];
        Qty: Decimal;
    begin
        HomeName := CompanyName();
        X154_ClearHomeActivity();

        Qty := SetupMgt.GetActivityQuantity(HomeName);

        Assert.AreEqual(0.0, Qty,
            'Expected no configured activity to read as zero rather than an arbitrary leftover value');
    end;

    [Test]
    procedure X154_ResettingAndReconfiguringTheRateIsReflectedOnTheNextLookup()
    var
        HomeName: Text[30];
        RateBefore: Decimal;
        RateAfter: Decimal;
    begin
        HomeName := CompanyName();
        X154_ClearHomeRate();
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 5.0);
        RateBefore := RateService.GetServiceRate(HomeName);

        RateService.Reset();
        SetupMgt.SetServiceRate(HomeName, 60.0);
        RateAfter := RateService.GetServiceRate(HomeName);

        X154_ClearHomeRate();

        Assert.AreEqual(5.0, RateBefore,
            'Expected the first lookup to reflect the rate configured at that point');
        Assert.AreEqual(60.0, RateAfter,
            'Expected a fresh lookup after reconfiguring the rate to reflect the newly configured value');
    end;

    // ==========================================================
    // X157 - donor CG-AL-X157
    // ==========================================================

    local procedure X157_ClearAll()
    var
        CostCenter: Record "CG X157 Cost Center";
        CostEntry: Record "CG X157 Cost Entry";
        StatementLine: Record "CG X157 Statement Line";
    begin
        CostCenter.DeleteAll();
        CostEntry.DeleteAll();
        StatementLine.DeleteAll();
    end;

    local procedure X157_SeedCostCenter(CostCenterCode: Code[20])
    var
        CostCenter: Record "CG X157 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Code" := CostCenterCode;
        CostCenter.Insert();
    end;

    local procedure X157_SeedEntry(CostCenterCode: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        CostEntry: Record "CG X157 Cost Entry";
    begin
        CostEntry.Init();
        CostEntry."Cost Center Code" := CostCenterCode;
        CostEntry."Posting Date" := PostingDate;
        CostEntry.Amount := Amount;
        CostEntry.Insert();
    end;

    local procedure X157_AssertStatementLine(CostCenterCode: Code[20]; PeriodStart: Date; ExpectedAmount: Decimal; MessagePrefix: Text)
    var
        StatementLine: Record "CG X157 Statement Line";
    begin
        Assert.IsTrue(StatementLine.Get(CostCenterCode, PeriodStart), MessagePrefix + ' - statement row exists');
        Assert.AreEqual(ExpectedAmount, StatementLine.Amount, MessagePrefix + ' - statement row amount');
    end;

    [Test]
    procedure X157_SinglePeriodWindowMatchingAllActivityReportsTheFullTotal()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'A window that covers a cost center''s only activity reports that activity''s full total');
    end;

    [Test]
    procedure X157_BuildStatementForOneCostCenterLeavesAnothersRowsAlone()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260115D, 70);

        Statement.BuildStatement('CC1', 20260101D, 20260131D);
        Statement.BuildStatement('CC2', 20260101D, 20260131D);

        X157_AssertStatementLine('CC1', 20260101D, 100, 'Another cost center''s statement rows must survive building this one''s');
        X157_AssertStatementLine('CC2', 20260101D, 70, 'The freshly built cost center''s own row must carry its own amount');
    end;

    [Test]
    procedure X157_StatementSpanningYearEndCarriesEachMonthsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20261210D, 90);
        X157_SeedEntry('CC1', 20270115D, 35);

        Statement.BuildStatement('CC1', 20261201D, 20270131D);

        X157_AssertStatementLine('CC1', 20261201D, 90, 'The December period of a statement spanning year end carries December''s own figure');
        X157_AssertStatementLine('CC1', 20270101D, 35, 'The January period of a statement spanning year end carries January''s own figure');
    end;

    [Test]
    procedure X157_MidYearWindowReportsOnlyThatMonthsActivity()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260201D, 20260228D);

        Assert.AreEqual(100, Result, 'A mid-year window must report only that window''s own activity, not the cost center''s entire history');
    end;

    [Test]
    procedure X157_NonAlignedWindowReportsOnlyActivityWithinItsExactDates()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260115D, 20260215D);

        Assert.AreEqual(80, Result, 'A window that does not line up with calendar month boundaries must still report only the activity that actually falls within it');
    end;

    [Test]
    procedure X157_StatementRowsCarryEachPeriodsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(3, StatementLine.Count(), 'A statement spanning three calendar months produces exactly three rows');
        X157_AssertStatementLine('CC1', 20260101D, 150, 'The first month''s row');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The second month''s row');
        X157_AssertStatementLine('CC1', 20260301D, 40, 'The third month''s row');
    end;

    [Test]
    procedure X157_WindowWithNoActivityReportsZero()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260401D, 20260430D);

        Assert.AreEqual(0, Result, 'A window with no activity in it must report zero, even though the cost center has activity elsewhere');
    end;

    [Test]
    procedure X157_AnotherCostCentersActivityDoesNotAffectThisOnesFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        ResultCC1: Decimal;
        ResultCC2: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260110D, 9999);

        ResultCC1 := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);
        ResultCC2 := Statement.GetPeriodAmount('CC2', 20260101D, 20260131D);

        Assert.AreEqual(100, ResultCC1, 'A cost center''s own figure must not include another cost center''s activity');
        Assert.AreEqual(9999, ResultCC2, 'The other cost center''s own figure must be unaffected by resolving the first one''s figure');
    end;

    [Test]
    procedure X157_ActivityOnTheWindowsFirstAndLastDayIsIncluded()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20251231D, 20);
        X157_SeedEntry('CC1', 20260101D, 100);
        X157_SeedEntry('CC1', 20260131D, 50);
        X157_SeedEntry('CC1', 20260201D, 30);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'Activity dated exactly on either edge of the window must be included, and activity just outside either edge must be excluded');
    end;

    [Test]
    procedure X157_RebuildingAStatementReplacesThePreviousRows()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);
        Statement.BuildStatement('CC1', 20260201D, 20260228D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(1, StatementLine.Count(), 'Rebuilding a statement for a narrower window must replace the previous rows, not add to them');
        Assert.IsFalse(StatementLine.Get('CC1', 20260101D), 'A row from the earlier, wider statement must not survive a rebuild');
        Assert.IsFalse(StatementLine.Get('CC1', 20260301D), 'A row from the earlier, wider statement must not survive a rebuild');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The rebuilt statement''s only row');
    end;
}
