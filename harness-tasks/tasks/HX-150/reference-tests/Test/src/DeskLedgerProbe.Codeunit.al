codeunit 80571 "CGR Desk Ledger Probe"
{
    var
        ActionToRun: Option " ",Post,Read,Insert,Modify,Delete;
        ContractNo: Code[20];
        EntryFound: Boolean;

    trigger OnRun()
    var
        Entry: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        case ActionToRun of
            ActionToRun::Post:
                RentalMgt.Post(ContractNo);
            ActionToRun::Read:
                begin
                    Entry.SetRange("Contract No.", ContractNo);
                    EntryFound := Entry.FindFirst();
                end;
            ActionToRun::Insert:
                begin
                    Entry.Init();
                    Entry."Contract No." := ContractNo;
                    Entry.Amount := 1;
                    Entry.Insert();
                end;
            ActionToRun::Modify:
                begin
                    Entry.SetRange("Contract No.", ContractNo);
                    Entry.FindFirst();
                    Entry.Amount := Entry.Amount + 1;
                    Entry.Modify();
                end;
            ActionToRun::Delete:
                begin
                    Entry.SetRange("Contract No.", ContractNo);
                    Entry.FindFirst();
                    Entry.Delete();
                end;
        end;
    end;

    procedure SetPost(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::Post;
        ContractNo := NewContractNo;
    end;

    procedure SetRead(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::Read;
        ContractNo := NewContractNo;
        EntryFound := false;
    end;

    procedure SetInsert(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::Insert;
        ContractNo := NewContractNo;
    end;

    procedure SetModify(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::Modify;
        ContractNo := NewContractNo;
    end;

    procedure SetDelete(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::Delete;
        ContractNo := NewContractNo;
    end;

    procedure Found(): Boolean
    begin
        exit(EntryFound);
    end;
}
