codeunit 88645 "HX179 VAT Diff Check Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        VATDiffCheck: Codeunit "CGR Lease VAT Diff. Check";
        GLAcc: Record "G/L Account";
        BalAcc: Record "G/L Account";
        TemplateNameHX179: Label 'HX179', Locked = true;
        BatchNameHX179: Label 'B1', Locked = true;
        CurrencyHX179: Label 'HX179E', Locked = true;

    [Test]
    procedure LcyRaisedVATOverMaximumListed()
    var
        LineNos: List of [Integer];
    begin
        ArrangeHX179(0.1, 1);
        AddLineHX179(10000, '', 0.5);

        LineNos := VATDiffCheck.ListExcessVATDifferences(TemplateNameHX179, BatchNameHX179);

        Assert.AreEqual(1, LineNos.Count(), 'Lines listed for a local-currency line raised by 0.50 over a 0.10 maximum');
        Assert.IsTrue(LineNos.Contains(10000), 'The raised local-currency line must be listed');
    end;

    [Test]
    procedure LcyLoweredVATListed()
    var
        LineNos: List of [Integer];
    begin
        ArrangeHX179(0.1, 1);
        AddLineHX179(10000, '', -0.5);

        LineNos := VATDiffCheck.ListExcessVATDifferences(TemplateNameHX179, BatchNameHX179);

        Assert.AreEqual(1, LineNos.Count(), 'Lines listed for a local-currency line lowered by 0.50 under a 0.10 maximum');
        Assert.IsTrue(LineNos.Contains(10000), 'The lowered local-currency line must be listed');
    end;

    [Test]
    procedure LcyDifferenceAtMaximumNotListed()
    var
        LineNos: List of [Integer];
    begin
        ArrangeHX179(0.5, 1);
        AddLineHX179(10000, '', 0.5);
        AddLineHX179(20000, '', -0.5);

        LineNos := VATDiffCheck.ListExcessVATDifferences(TemplateNameHX179, BatchNameHX179);

        Assert.AreEqual(0, LineNos.Count(), 'A difference equal to the maximum is allowed');
    end;

    [Test]
    procedure CurrencyLineOverItsLimitListed()
    var
        LineNos: List of [Integer];
    begin
        ArrangeHX179(1, 0.1);
        AddLineHX179(10000, CurrencyHX179, 0.5);

        LineNos := VATDiffCheck.ListExcessVATDifferences(TemplateNameHX179, BatchNameHX179);

        Assert.AreEqual(1, LineNos.Count(), 'Lines listed for a foreign-currency line the journal refuses');
        Assert.IsTrue(LineNos.Contains(10000), 'The foreign-currency line over its maximum must be listed');
    end;

    [Test]
    procedure CurrencyLineWithinItsLimitNotListed()
    var
        LineNos: List of [Integer];
    begin
        ArrangeHX179(0.1, 1);
        AddLineHX179(10000, CurrencyHX179, 0.5);

        LineNos := VATDiffCheck.ListExcessVATDifferences(TemplateNameHX179, BatchNameHX179);

        Assert.AreEqual(0, LineNos.Count(), 'A foreign-currency line the journal accepts must not be listed');
    end;

    [Test]
    procedure CurrencyLoweredVATOverLimitListed()
    var
        LineNos: List of [Integer];
    begin
        ArrangeHX179(1, 0.1);
        AddLineHX179(10000, CurrencyHX179, -0.5);

        LineNos := VATDiffCheck.ListExcessVATDifferences(TemplateNameHX179, BatchNameHX179);

        Assert.AreEqual(1, LineNos.Count(), 'Lines listed for a lowered foreign-currency line over its maximum');
        Assert.IsTrue(LineNos.Contains(10000), 'The lowered foreign-currency line must be listed');
    end;

    [Test]
    procedure MixedBatchListsByEachLinesLimit()
    var
        LineNos: List of [Integer];
    begin
        ArrangeHX179(0.1, 1);
        AddLineHX179(10000, '', 0.5);
        AddLineHX179(20000, CurrencyHX179, 0.5);
        AddLineHX179(30000, CurrencyHX179, -1.5);
        AddLineHX179(40000, '', 0.05);

        LineNos := VATDiffCheck.ListExcessVATDifferences(TemplateNameHX179, BatchNameHX179);

        Assert.AreEqual(2, LineNos.Count(), 'Lines listed in a batch of local and foreign-currency lines');
        Assert.IsTrue(LineNos.Contains(10000), 'The local-currency line over 0.10 must be listed');
        Assert.IsTrue(LineNos.Contains(30000), 'The foreign-currency line lowered by 1.50 must be listed');
    end;

    local procedure ArrangeHX179(GLMax: Decimal; CurrencyMax: Decimal)
    var
        GenJnlLine: Record "Gen. Journal Line";
        GLSetup: Record "General Ledger Setup";
        Currency: Record Currency;
    begin
        WorkDate(DMY2Date(15, 1, 2026));
        SetupAccountsHX179();
        SetupJournalHX179();
        SetupCurrencyHX179();

        GLSetup.Get();
        GLSetup."Max. VAT Difference Allowed" := GLMax;
        GLSetup.Modify();
        Currency.Get(CurrencyHX179);
        Currency."Max. VAT Difference Allowed" := CurrencyMax;
        Currency.Modify();

        GenJnlLine.SetRange("Journal Template Name", TemplateNameHX179);
        GenJnlLine.SetRange("Journal Batch Name", BatchNameHX179);
        GenJnlLine.DeleteAll();
    end;

    local procedure SetupAccountsHX179()
    var
        GenPostSetup: Record "General Posting Setup";
        VATPostSetup: Record "VAT Posting Setup";
    begin
        GenPostSetup.SetFilter("Gen. Bus. Posting Group", '<>%1', '');
        GenPostSetup.SetFilter("Gen. Prod. Posting Group", '<>%1', '');
        GenPostSetup.FindFirst();
        VATPostSetup.SetRange("VAT Calculation Type", VATPostSetup."VAT Calculation Type"::"Normal VAT");
        VATPostSetup.SetRange("VAT %", 25);
        VATPostSetup.SetFilter("VAT Bus. Posting Group", '<>%1', '');
        VATPostSetup.SetFilter("Purchase VAT Account", '<>%1', '');
        VATPostSetup.FindFirst();

        Clear(GLAcc);
        GLAcc.SetRange("Account Type", GLAcc."Account Type"::Posting);
        GLAcc.SetRange("Direct Posting", true);
        GLAcc.SetRange(Blocked, false);
        GLAcc.SetRange("Income/Balance", GLAcc."Income/Balance"::"Income Statement");
        GLAcc.FindFirst();
        GLAcc."Gen. Posting Type" := GLAcc."Gen. Posting Type"::Purchase;
        GLAcc."Gen. Bus. Posting Group" := GenPostSetup."Gen. Bus. Posting Group";
        GLAcc."Gen. Prod. Posting Group" := GenPostSetup."Gen. Prod. Posting Group";
        GLAcc."VAT Bus. Posting Group" := VATPostSetup."VAT Bus. Posting Group";
        GLAcc."VAT Prod. Posting Group" := VATPostSetup."VAT Prod. Posting Group";
        GLAcc.Modify();

        Clear(BalAcc);
        BalAcc.SetRange("Account Type", BalAcc."Account Type"::Posting);
        BalAcc.SetRange("Direct Posting", true);
        BalAcc.SetRange(Blocked, false);
        BalAcc.SetRange("Income/Balance", BalAcc."Income/Balance"::"Balance Sheet");
        BalAcc.SetRange("Gen. Posting Type", BalAcc."Gen. Posting Type"::" ");
        BalAcc.FindFirst();
    end;

    local procedure SetupJournalHX179()
    var
        Template: Record "Gen. Journal Template";
        Batch: Record "Gen. Journal Batch";
    begin
        if not Template.Get(TemplateNameHX179) then begin
            Template.Init();
            Template.Name := TemplateNameHX179;
            Template.Type := Template.Type::General;
            Template.Insert();
        end;
        if not Batch.Get(TemplateNameHX179, BatchNameHX179) then begin
            Batch.Init();
            Batch."Journal Template Name" := TemplateNameHX179;
            Batch.Name := BatchNameHX179;
            Batch.Insert();
        end;
        Batch."Allow VAT Difference" := true;
        Batch.Modify();
    end;

    local procedure SetupCurrencyHX179()
    var
        Currency: Record Currency;
        Rate: Record "Currency Exchange Rate";
    begin
        if not Currency.Get(CurrencyHX179) then begin
            Currency.Init();
            Currency.Code := CurrencyHX179;
            Currency."Amount Rounding Precision" := 0.01;
            Currency."Invoice Rounding Precision" := 0.01;
            Currency."Unit-Amount Rounding Precision" := 0.00001;
            Currency.Insert();
        end;
        if not Rate.Get(CurrencyHX179, DMY2Date(1, 1, 2020)) then begin
            Rate.Init();
            Rate."Currency Code" := CurrencyHX179;
            Rate."Starting Date" := DMY2Date(1, 1, 2020);
            Rate."Exchange Rate Amount" := 100;
            Rate."Adjustment Exch. Rate Amount" := 100;
            Rate."Relational Exch. Rate Amount" := 700;
            Rate."Relational Adjmt Exch Rate Amt" := 700;
            Rate.Insert();
        end;
    end;

    local procedure AddLineHX179(LineNo: Integer; CurrencyCode: Code[10]; VATDifference: Decimal)
    var
        GenJnlLine: Record "Gen. Journal Line";
    begin
        GenJnlLine.Init();
        GenJnlLine."Journal Template Name" := TemplateNameHX179;
        GenJnlLine."Journal Batch Name" := BatchNameHX179;
        GenJnlLine."Line No." := LineNo;
        GenJnlLine.Insert();
        GenJnlLine.Validate("Posting Date", WorkDate());
        GenJnlLine."Document No." := 'HX179-' + Format(LineNo);
        GenJnlLine.Validate("Account Type", GenJnlLine."Account Type"::"G/L Account");
        GenJnlLine.Validate("Account No.", GLAcc."No.");
        GenJnlLine.Validate("Bal. Account Type", GenJnlLine."Bal. Account Type"::"G/L Account");
        GenJnlLine.Validate("Bal. Account No.", BalAcc."No.");
        if CurrencyCode <> '' then begin
            GenJnlLine.Validate("Currency Code", CurrencyCode);
            Assert.AreNotEqual(0, GenJnlLine."Currency Factor", 'Arrange: the foreign-currency line needs an exchange rate');
        end;
        GenJnlLine.Validate(Amount, 125);
        // The difference is stored as the journal holds it after someone typed a new VAT amount.
        GenJnlLine."VAT Amount" := GenJnlLine."VAT Amount" + VATDifference;
        GenJnlLine."VAT Base Amount" := GenJnlLine.Amount - GenJnlLine."VAT Amount";
        GenJnlLine."VAT Difference" := VATDifference;
        GenJnlLine.Modify();
    end;
}
