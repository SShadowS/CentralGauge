codeunit 80332 "CG-AL-X043 Test"
{
    // Tests for CG-AL-X043: custom "CG Ref Code" field cascades from the
    // Purchase Header, through the standard posting pipeline, onto the
    // posted Vendor Ledger Entry and the payables G/L Entry.
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibraryPurchase: Codeunit "Library - Purchase";
        LibraryERM: Codeunit "Library - ERM";
        LibraryRandom: Codeunit "Library - Random";

    [Test]
    procedure TestRefCodeCascadesToVendorLedgerAndPayablesGLEntry()
    var
        Vendor: Record Vendor;
        VendorPostingGroup: Record "Vendor Posting Group";
        PurchaseHeader: Record "Purchase Header";
        PurchaseLine: Record "Purchase Line";
        VendorLedgerEntry: Record "Vendor Ledger Entry";
        GLEntry: Record "G/L Entry";
        RefCode: Code[20];
        DocumentNo: Code[20];
    begin
        // [SCENARIO] A "CG Ref Code" value set on a Purchase Header before
        // posting a purchase invoice must appear on the resulting posted
        // Vendor Ledger Entry and on the payables G/L Entry for that posting.

        // [GIVEN] A vendor and a purchase invoice for it with one line, with
        // "CG Ref Code" set on the header before posting
        LibraryPurchase.CreateVendor(Vendor);
        LibraryPurchase.CreatePurchHeader(PurchaseHeader, PurchaseHeader."Document Type"::Invoice, Vendor."No.");

        RefCode := CopyStr('REF-' + Format(LibraryRandom.RandIntInRange(100000, 999999)), 1, 20);
        PurchaseHeader."CG Ref Code" := RefCode;
        PurchaseHeader.Modify(true);

        LibraryPurchase.CreatePurchaseLine(PurchaseLine, PurchaseHeader, PurchaseLine.Type::"G/L Account", '', 1);
        PurchaseLine.Validate("Direct Unit Cost", LibraryRandom.RandDecInRange(100, 500, 2));
        PurchaseLine.Modify(true);

        // [WHEN] The invoice is posted
        DocumentNo := LibraryPurchase.PostPurchaseDocument(PurchaseHeader, false, true);

        // [THEN] The posted Vendor Ledger Entry carries the ref code
        VendorLedgerEntry.SetRange("Document No.", DocumentNo);
        VendorLedgerEntry.SetRange("Vendor No.", Vendor."No.");
        Assert.IsTrue(VendorLedgerEntry.FindFirst(), 'Expected a posted Vendor Ledger Entry for the invoice');
        Assert.AreEqual(
            RefCode, VendorLedgerEntry."CG Ref Code",
            'Vendor Ledger Entry should carry the CG Ref Code from the Purchase Header');

        // [THEN] The payables G/L Entry (posted to the vendor posting group's
        // Payables Account) carries the ref code too
        Vendor.Get(Vendor."No.");
        VendorPostingGroup.Get(Vendor."Vendor Posting Group");

        GLEntry.SetRange("Document No.", DocumentNo);
        GLEntry.SetRange("G/L Account No.", VendorPostingGroup."Payables Account");
        Assert.IsTrue(GLEntry.FindFirst(), 'Expected a posted payables G/L Entry for the invoice');
        Assert.AreEqual(
            RefCode, GLEntry."CG Ref Code",
            'Payables G/L Entry should carry the CG Ref Code from the Purchase Header');
    end;
}
