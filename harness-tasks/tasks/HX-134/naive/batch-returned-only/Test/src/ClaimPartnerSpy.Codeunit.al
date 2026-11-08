codeunit 80341 "CGR Claim Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        TargetContractNo: Code[20];
        WriteClaim: Boolean;
        CommitClaim: Boolean;
        RefusePosting: Boolean;
        PostingsSeen: Integer;
        PartnerRefusedErr: Label 'Insurance partner refused contract %1.', Comment = '%1 = contract number';

    procedure SetClaimPartner(ContractNo: Code[20]; NewWriteClaim: Boolean; NewCommitClaim: Boolean; NewRefusePosting: Boolean)
    begin
        TargetContractNo := ContractNo;
        WriteClaim := NewWriteClaim;
        CommitClaim := NewCommitClaim;
        RefusePosting := NewRefusePosting;
    end;

    procedure PostingsSeenByPartner(): Integer
    begin
        exit(PostingsSeen);
    end;

    procedure ClaimRefusalText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(PartnerRefusedErr, ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure RecordClaim(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    var
        Claim: Record "CGR Partner Claim Record";
    begin
        PostingsSeen += 1;
        if RentalContract."No." <> TargetContractNo then
            exit;
        if WriteClaim then begin
            Claim.Init();
            Claim."Contract No." := RentalContract."No.";
            Claim.Amount := Amount;
            Claim.Insert();
            if CommitClaim then
                Commit();
        end;
        if RefusePosting then
            Error(PartnerRefusedErr, RentalContract."No.");
    end;
}
