codeunit 88420 "HX164 Workshop Match Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Matching: Codeunit "CGR Repair Invoice Matching";
        VATPostSetup: Record "VAT Posting Setup";

    [Test]
    procedure AllPositiveTotalMatchesWorkshop()
    var
        PurchHeader: Record "Purchase Header";
    begin
        ArrangeInvoiceHX164(PurchHeader, true, false, 10);

        Matching.MatchToWorkshopTotal(PurchHeader, 376);

        Assert.AreEqual(376.0, SumAmountInclVATHX164(PurchHeader), 'Amount including VAT of the invoice');
    end;

    [Test]
    procedure AllPositiveNonDeductibleFollowsSetup()
    var
        PurchHeader: Record "Purchase Header";
    begin
        ArrangeInvoiceHX164(PurchHeader, true, false, 10);

        Matching.MatchToWorkshopTotal(PurchHeader, 376);

        Assert.AreEqual(38.0, SumNonDeductibleHX164(PurchHeader), 'Non-deductible VAT of the invoice');
    end;

    [Test]
    procedure GoodwillTotalMatchesWorkshop()
    var
        PurchHeader: Record "Purchase Header";
    begin
        ArrangeInvoiceHX164(PurchHeader, true, true, 10);

        RunMatchHX164(PurchHeader, 313.5);

        Assert.AreEqual(313.5, SumAmountInclVATHX164(PurchHeader), 'Amount including VAT of the goodwill invoice');
    end;

    [Test]
    procedure GoodwillNonDeductibleFollowsSetup()
    var
        PurchHeader: Record "Purchase Header";
    begin
        ArrangeInvoiceHX164(PurchHeader, true, true, 10);

        RunMatchHX164(PurchHeader, 313.5);

        Assert.AreEqual(31.75, SumNonDeductibleHX164(PurchHeader), 'Non-deductible VAT of the goodwill invoice');
    end;

    [Test]
    procedure GoodwillDownwardDifferenceMatches()
    var
        PurchHeader: Record "Purchase Header";
    begin
        ArrangeInvoiceHX164(PurchHeader, true, true, 10);

        RunMatchHX164(PurchHeader, 311.5);

        Assert.AreEqual(311.5, SumAmountInclVATHX164(PurchHeader), 'Amount including VAT of the goodwill invoice');
        Assert.AreEqual(30.75, SumNonDeductibleHX164(PurchHeader), 'Non-deductible VAT of the goodwill invoice');
    end;

    [Test]
    procedure NoNonDeductibleMatchesTotal()
    var
        PurchHeader: Record "Purchase Header";
    begin
        ArrangeInvoiceHX164(PurchHeader, false, false, 10);

        Matching.MatchToWorkshopTotal(PurchHeader, 376);

        Assert.AreEqual(376.0, SumAmountInclVATHX164(PurchHeader), 'Amount including VAT without Non-Deductible VAT');
        Assert.AreEqual(0.0, SumNonDeductibleHX164(PurchHeader), 'Non-deductible VAT without Non-Deductible VAT');
    end;

    [Test]
    procedure DifferenceAboveMaximumRefused()
    var
        PurchHeader: Record "Purchase Header";
        InclBefore: Decimal;
        NonDeductibleBefore: Decimal;
    begin
        ArrangeInvoiceHX164(PurchHeader, true, false, 5);
        InclBefore := SumAmountInclVATHX164(PurchHeader);
        NonDeductibleBefore := SumNonDeductibleHX164(PurchHeader);

        asserterror Matching.MatchToWorkshopTotal(PurchHeader, 385);

        Assert.ExpectedError('The workshop total differs from the calculated total by 10, which is more than the allowed 5.');
        Assert.AreEqual(InclBefore, SumAmountInclVATHX164(PurchHeader), 'A refused difference leaves the amount including VAT');
        Assert.AreEqual(NonDeductibleBefore, SumNonDeductibleHX164(PurchHeader), 'A refused difference leaves the non-deductible VAT');
    end;

    [Test]
    procedure DifferenceAtMaximumMatched()
    var
        PurchHeader: Record "Purchase Header";
    begin
        ArrangeInvoiceHX164(PurchHeader, true, false, 5);

        Matching.MatchToWorkshopTotal(PurchHeader, 380);

        Assert.AreEqual(380.0, SumAmountInclVATHX164(PurchHeader), 'A difference at the maximum is matched');
    end;

    local procedure RunMatchHX164(PurchHeader: Record "Purchase Header"; WorkshopTotal: Decimal)
    var
        Runner: Codeunit "HX164 Match Runner";
        Ok: Boolean;
    begin
        Runner.SetMatchHX164(PurchHeader."No.", WorkshopTotal);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The invoice must be matched, but it stopped with: ' + GetLastErrorText());
    end;

    local procedure ArrangeInvoiceHX164(var PurchHeader: Record "Purchase Header"; NonDeductibleEnabled: Boolean; WithGoodwill: Boolean; MaxDifference: Decimal)
    var
        ItemNo: Code[20];
        VendorNo: Code[20];
    begin
        SetupVATHX164(NonDeductibleEnabled);
        SetupMaximumHX164(MaxDifference);
        EnsureMasterDataHX164(VendorNo, ItemNo);

        PurchHeader.Init();
        PurchHeader."Document Type" := PurchHeader."Document Type"::Invoice;
        PurchHeader.Insert(true);
        PurchHeader.Validate("Buy-from Vendor No.", VendorNo);
        PurchHeader.Validate("Prices Including VAT", false);
        PurchHeader.Modify(true);
        AddLineHX164(PurchHeader, 10000, ItemNo, 1, 100);
        AddLineHX164(PurchHeader, 20000, ItemNo, 1, 200);
        if WithGoodwill then
            AddLineHX164(PurchHeader, 30000, ItemNo, -1, 50);
        Commit();
    end;

    local procedure SetupVATHX164(NonDeductibleEnabled: Boolean)
    var
        VATSetup: Record "VAT Setup";
        GLSetup: Record "General Ledger Setup";
        PPSetup: Record "Purchases & Payables Setup";
    begin
        if not VATSetup.Get() then begin
            VATSetup.Init();
            VATSetup.Insert();
        end;
        VATSetup."Enable Non-Deductible VAT" := NonDeductibleEnabled;
        VATSetup."Non-Deductible VAT Is Enabled" := NonDeductibleEnabled;
        VATSetup.Modify();
        GLSetup.Get();
        GLSetup."Max. VAT Difference Allowed" := 10;
        GLSetup.Modify();
        PPSetup.Get();
        PPSetup."Allow VAT Difference" := true;
        PPSetup.Modify();

        Clear(VATPostSetup);
        VATPostSetup.SetRange("VAT Calculation Type", VATPostSetup."VAT Calculation Type"::"Normal VAT");
        VATPostSetup.SetRange("VAT %", 25);
        VATPostSetup.SetFilter("VAT Bus. Posting Group", '<>%1', '');
        VATPostSetup.SetFilter("VAT Prod. Posting Group", '<>%1', '');
        VATPostSetup.SetFilter("Purchase VAT Account", '<>%1', '');
        VATPostSetup.FindFirst();
        if NonDeductibleEnabled then begin
            VATPostSetup."Allow Non-Deductible VAT" := VATPostSetup."Allow Non-Deductible VAT"::Allow;
            VATPostSetup."Non-Deductible VAT %" := 50;
        end else begin
            VATPostSetup."Allow Non-Deductible VAT" := VATPostSetup."Allow Non-Deductible VAT"::"Do Not Allow";
            VATPostSetup."Non-Deductible VAT %" := 0;
        end;
        VATPostSetup.Modify();
    end;

    local procedure SetupMaximumHX164(MaxDifference: Decimal)
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Max. Workshop VAT Diff." := MaxDifference;
        Setup.Modify();
    end;

    local procedure EnsureMasterDataHX164(var VendorNo: Code[20]; var ItemNo: Code[20])
    var
        GenPostSetup: Record "General Posting Setup";
        VendPG: Record "Vendor Posting Group";
        InvPostSetup: Record "Inventory Posting Setup";
        UoM: Record "Unit of Measure";
        ItemUoM: Record "Item Unit of Measure";
        Vendor: Record Vendor;
        Item: Record Item;
    begin
        VendorNo := 'HX164-V';
        ItemNo := 'HX164-I';
        if Vendor.Get(VendorNo) then
            exit;

        GenPostSetup.SetFilter("Gen. Bus. Posting Group", '<>%1', '');
        GenPostSetup.SetFilter("Gen. Prod. Posting Group", '<>%1', '');
        GenPostSetup.SetFilter("Purch. Account", '<>%1', '');
        GenPostSetup.FindFirst();
        VendPG.SetFilter("Payables Account", '<>%1', '');
        VendPG.FindFirst();
        InvPostSetup.SetRange("Location Code", '');
        InvPostSetup.FindFirst();
        if not UoM.Get('HX164') then begin
            UoM.Init();
            UoM.Code := 'HX164';
            UoM.Insert();
        end;

        Vendor.Init();
        Vendor."No." := VendorNo;
        Vendor.Insert(true);
        Vendor."Gen. Bus. Posting Group" := GenPostSetup."Gen. Bus. Posting Group";
        Vendor."VAT Bus. Posting Group" := VATPostSetup."VAT Bus. Posting Group";
        Vendor."Vendor Posting Group" := VendPG.Code;
        Vendor.Modify(true);

        Item.Init();
        Item."No." := ItemNo;
        Item.Insert(true);
        Item.Type := Item.Type::Inventory;
        ItemUoM.Init();
        ItemUoM."Item No." := Item."No.";
        ItemUoM.Code := UoM.Code;
        ItemUoM."Qty. per Unit of Measure" := 1;
        ItemUoM.Insert();
        Item."Base Unit of Measure" := UoM.Code;
        Item."Gen. Prod. Posting Group" := GenPostSetup."Gen. Prod. Posting Group";
        Item."VAT Prod. Posting Group" := VATPostSetup."VAT Prod. Posting Group";
        Item."Inventory Posting Group" := InvPostSetup."Invt. Posting Group Code";
        Item.Modify(true);
    end;

    local procedure AddLineHX164(PurchHeader: Record "Purchase Header"; LineNo: Integer; ItemNo: Code[20]; Qty: Decimal; Cost: Decimal)
    var
        PurchLine: Record "Purchase Line";
    begin
        PurchLine.Init();
        PurchLine."Document Type" := PurchHeader."Document Type";
        PurchLine."Document No." := PurchHeader."No.";
        PurchLine."Line No." := LineNo;
        PurchLine.Insert(true);
        PurchLine.Validate(Type, PurchLine.Type::Item);
        PurchLine.Validate("No.", ItemNo);
        PurchLine.Validate(Quantity, Qty);
        PurchLine.Validate("Direct Unit Cost", Cost);
        PurchLine.Modify(true);
    end;

    local procedure SumAmountInclVATHX164(PurchHeader: Record "Purchase Header") Total: Decimal
    var
        PurchLine: Record "Purchase Line";
    begin
        PurchLine.SetRange("Document Type", PurchHeader."Document Type");
        PurchLine.SetRange("Document No.", PurchHeader."No.");
        if PurchLine.FindSet() then
            repeat
                Total += PurchLine."Amount Including VAT";
            until PurchLine.Next() = 0;
    end;

    local procedure SumNonDeductibleHX164(PurchHeader: Record "Purchase Header") Total: Decimal
    var
        PurchLine: Record "Purchase Line";
    begin
        PurchLine.SetRange("Document Type", PurchHeader."Document Type");
        PurchLine.SetRange("Document No.", PurchHeader."No.");
        if PurchLine.FindSet() then
            repeat
                Total += PurchLine."Non-Deductible VAT Amount";
            until PurchLine.Next() = 0;
    end;
}
