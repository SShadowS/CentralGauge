codeunit 80340 "CGR Rental Posting Check Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NotReturnedTxt: Label 'Rental contract %1 must be returned before it is posted.', Locked = true;

    [Test]
    procedure ReturnedContractWouldPostAndStaysReturned()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PostingCheck: Codeunit "CGR Rental Posting Check";
        ContractNo: Code[20];
        ErrorText: Text;
        WouldPost: Boolean;
    begin
        HX134Arrange('HX134-V1');
        ContractNo := HX134ReturnedContract('HX134-V1', 1200);

        Commit();
        WouldPost := PostingCheck.CheckPosting(ContractNo, ErrorText);

        Assert.IsTrue(WouldPost, 'A returned contract with a price would post: ' + ErrorText);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The check does not change the status');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'The check keeps no ledger entry');
    end;

    [Test]
    procedure CommittingPartnerKeepsNoClaim()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Claim: Record "CGR Partner Claim Record";
        Spy: Codeunit "CGR Claim Partner Spy";
        PostingCheck: Codeunit "CGR Rental Posting Check";
        ContractNo: Code[20];
        ErrorText: Text;
        WouldPost: Boolean;
    begin
        HX134Arrange('HX134-V2');
        ContractNo := HX134ReturnedContract('HX134-V2', 1300);
        Spy.SetClaimPartner(ContractNo, true, true, false);
        BindSubscription(Spy);

        Commit();
        WouldPost := PostingCheck.CheckPosting(ContractNo, ErrorText);
        UnbindSubscription(Spy);

        Assert.IsTrue(WouldPost, 'The contract would post: ' + ErrorText);
        Assert.AreEqual(1, Spy.PostingsSeenByPartner(), 'The partner app saw the posting');
        Claim.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Claim.Count(), 'The claim the partner committed during the check is not kept');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry is kept although the partner committed');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The status is unchanged although the partner committed');
    end;

    [Test]
    procedure PartnerCommitThenRefusalKeepsNothing()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Claim: Record "CGR Partner Claim Record";
        Spy: Codeunit "CGR Claim Partner Spy";
        PostingCheck: Codeunit "CGR Rental Posting Check";
        ContractNo: Code[20];
        ErrorText: Text;
        WouldPost: Boolean;
    begin
        HX134Arrange('HX134-V3');
        ContractNo := HX134ReturnedContract('HX134-V3', 1400);
        Spy.SetClaimPartner(ContractNo, true, true, true);
        BindSubscription(Spy);

        Commit();
        WouldPost := PostingCheck.CheckPosting(ContractNo, ErrorText);
        UnbindSubscription(Spy);

        Assert.IsFalse(WouldPost, 'Posting would fail on the partner refusal');
        Assert.AreEqual(Spy.ClaimRefusalText(ContractNo), ErrorText, 'ErrorText holds the error posting would raise');
        Claim.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Claim.Count(), 'The committed claim is not kept');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry is kept');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The status is unchanged');
    end;

    [Test]
    procedure OpenContractReportsPostingError()
    var
        Contract: Record "CGR Rental Contract";
        PostingCheck: Codeunit "CGR Rental Posting Check";
        ContractNo: Code[20];
        ErrorText: Text;
        WouldPost: Boolean;
    begin
        HX134Arrange('HX134-V4');
        ContractNo := Lib.CreateContract('HX134-V4');

        Commit();
        WouldPost := PostingCheck.CheckPosting(ContractNo, ErrorText);

        Assert.IsFalse(WouldPost, 'An open contract would not post');
        Assert.AreEqual(StrSubstNo(NotReturnedTxt, ContractNo), ErrorText, 'ErrorText holds the posting error');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The open contract is unchanged');
    end;

    [Test]
    procedure BatchCountsReturnedContractsThatWouldPost()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Spy: Codeunit "CGR Claim Partner Spy";
        PostingCheck: Codeunit "CGR Rental Posting Check";
        Results: Dictionary of [Code[20], Text];
        FirstNo: Code[20];
        RefusedNo: Code[20];
        LastNo: Code[20];
        OpenNo: Code[20];
        WouldPost: Integer;
    begin
        HX134Arrange('HX134-VB');
        FirstNo := HX134ReturnedContract('HX134-VB', 1100);
        RefusedNo := HX134ReturnedContract('HX134-VB', 1200);
        LastNo := HX134ReturnedContract('HX134-VB', 1300);
        OpenNo := Lib.CreateContract('HX134-VB');
        Spy.SetClaimPartner(RefusedNo, false, false, true);
        BindSubscription(Spy);
        Contract.SetRange("Vehicle No.", 'HX134-VB');

        Commit();
        WouldPost := PostingCheck.CheckBatch(Contract, Results);
        UnbindSubscription(Spy);

        Assert.AreEqual(2, WouldPost, 'Two of the three returned contracts would post');
        Assert.AreEqual(1, Results.Count(), 'Only the refused contract would fail');
        Assert.IsTrue(Results.ContainsKey(RefusedNo), 'The refused contract is in Results');
        Assert.AreEqual(Spy.ClaimRefusalText(RefusedNo), Results.Get(RefusedNo), 'Results holds the refusal error');
        Assert.IsFalse(Results.ContainsKey(OpenNo), 'The open contract is not checked');
        Assert.IsFalse(Results.ContainsKey(FirstNo), 'A contract that would post is not in Results');
        LedgerEntry.SetRange("Vehicle No.", 'HX134-VB');
        Assert.AreEqual(0, LedgerEntry.Count(), 'The batch check keeps no ledger entry');
        Contract.Get(LastNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The batch check changes no status');
    end;

    local procedure HX134Arrange(VehicleNo: Code[20])
    begin
        WorkDate(20270310D);
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
        Lib.ClearLedgerEntries(VehicleNo);
    end;

    local procedure HX134ReturnedContract(VehicleNo: Code[20]; ReturnKm: Integer): Code[20]
    var
        Claim: Record "CGR Partner Claim Record";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateReturnedContract(VehicleNo, 20270301D, 20270303D, ReturnKm);
        Claim.SetRange("Contract No.", ContractNo);
        Claim.DeleteAll();
        exit(ContractNo);
    end;
}
