codeunit 70240 "CGR Rental Preview Runner"
{
    TableNo = "CGR Rental Ledger Entry";

    var
        PreviewContractNo: Code[20];

    trigger OnRun()
    begin
        PostAndCapture(Rec);
        Error('');
    end;

    procedure SetPreviewContract(ContractNo: Code[20])
    begin
        PreviewContractNo := ContractNo;
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    local procedure PostAndCapture(var LedgerBuffer: Record "CGR Rental Ledger Entry")
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        RentalPost: Codeunit "CGR Rental-Post";
    begin
        Contract.Get(PreviewContractNo);
        RentalPost.Run(Contract);
        LedgerEntry.SetRange("Contract No.", PreviewContractNo);
        LedgerEntry.FindLast();
        LedgerBuffer := LedgerEntry;
        LedgerBuffer.Insert();
    end;
}
