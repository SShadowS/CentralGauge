codeunit 80345 "CGR Posting Check Naive B"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NotReturnedTxt: Label 'Rental contract %1 must be returned before it is posted.', Locked = true;

    [Test]
    procedure ReturnedContractWouldPost()
    var
        PostingCheck: Codeunit "CGR Rental Posting Check";
        ContractNo: Code[20];
        ErrorText: Text;
    begin
        HX134Arrange('HX134-N1');
        ContractNo := Lib.CreateReturnedContract('HX134-N1', 20270301D, 20270303D, 1200);

        Commit();
        Assert.IsTrue(PostingCheck.CheckPosting(ContractNo, ErrorText), 'A returned contract would post: ' + ErrorText);
    end;

    [Test]
    procedure PartnerRefusalIsReported()
    var
        Spy: Codeunit "CGR Claim Partner Spy";
        PostingCheck: Codeunit "CGR Rental Posting Check";
        ContractNo: Code[20];
        ErrorText: Text;
        WouldPost: Boolean;
    begin
        HX134Arrange('HX134-N2');
        ContractNo := Lib.CreateReturnedContract('HX134-N2', 20270301D, 20270303D, 1300);
        Spy.SetClaimPartner(ContractNo, false, false, true);
        BindSubscription(Spy);

        Commit();
        WouldPost := PostingCheck.CheckPosting(ContractNo, ErrorText);
        UnbindSubscription(Spy);

        Assert.IsFalse(WouldPost, 'Posting would fail on the partner refusal');
        Assert.AreEqual(Spy.ClaimRefusalText(ContractNo), ErrorText, 'ErrorText holds the refusal');
    end;

    [Test]
    procedure OpenContractWouldNotPost()
    var
        PostingCheck: Codeunit "CGR Rental Posting Check";
        ContractNo: Code[20];
        ErrorText: Text;
    begin
        HX134Arrange('HX134-N3');
        ContractNo := Lib.CreateContract('HX134-N3');

        Commit();
        Assert.IsFalse(PostingCheck.CheckPosting(ContractNo, ErrorText), 'An open contract would not post');
        Assert.AreEqual(StrSubstNo(NotReturnedTxt, ContractNo), ErrorText, 'ErrorText holds the posting error');
    end;

    [Test]
    procedure BatchCountsAndReportsFailures()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Claim Partner Spy";
        PostingCheck: Codeunit "CGR Rental Posting Check";
        Results: Dictionary of [Code[20], Text];
        RefusedNo: Code[20];
        OpenNo: Code[20];
        WouldPost: Integer;
    begin
        HX134Arrange('HX134-NB');
        Lib.CreateReturnedContract('HX134-NB', 20270301D, 20270303D, 1100);
        RefusedNo := Lib.CreateReturnedContract('HX134-NB', 20270301D, 20270303D, 1200);
        Lib.CreateReturnedContract('HX134-NB', 20270301D, 20270303D, 1300);
        OpenNo := Lib.CreateContract('HX134-NB');
        Spy.SetClaimPartner(RefusedNo, false, false, true);
        BindSubscription(Spy);
        Contract.SetRange("Vehicle No.", 'HX134-NB');

        Commit();
        WouldPost := PostingCheck.CheckBatch(Contract, Results);
        UnbindSubscription(Spy);

        Assert.AreEqual(2, WouldPost, 'Two returned contracts would post');
        Assert.AreEqual(1, Results.Count(), 'One contract would fail');
        Assert.IsTrue(Results.ContainsKey(RefusedNo), 'The refused contract is reported');
        Assert.IsFalse(Results.ContainsKey(OpenNo), 'The open contract is not checked');
    end;

    local procedure HX134Arrange(VehicleNo: Code[20])
    begin
        WorkDate(20270310D);
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
        Lib.ClearLedgerEntries(VehicleNo);
    end;
}
