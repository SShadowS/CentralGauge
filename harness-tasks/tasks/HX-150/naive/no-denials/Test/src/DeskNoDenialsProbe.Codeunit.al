codeunit 80573 "CGR Desk No Denials Probe"
{
    var
        ReadOnly: Boolean;
        ContractNo: Code[20];
        EntryFound: Boolean;

    trigger OnRun()
    var
        Entry: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        if ReadOnly then begin
            Entry.SetRange("Contract No.", ContractNo);
            EntryFound := Entry.FindFirst();
        end else
            RentalMgt.Post(ContractNo);
    end;

    procedure SetPost(NewContractNo: Code[20])
    begin
        ReadOnly := false;
        ContractNo := NewContractNo;
    end;

    procedure SetRead(NewContractNo: Code[20])
    begin
        ReadOnly := true;
        ContractNo := NewContractNo;
        EntryFound := false;
    end;

    procedure Found(): Boolean
    begin
        exit(EntryFound);
    end;
}
