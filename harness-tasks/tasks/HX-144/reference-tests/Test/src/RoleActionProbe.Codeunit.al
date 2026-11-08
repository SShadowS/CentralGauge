codeunit 80521 "CGR Role Action Probe"
{
    var
        ActionToRun: Option " ",Create,CheckOut,Return,Post,Delete;
        VehicleNo: Code[20];
        ContractNo: Code[20];
        ReturnKm: Integer;
        DamageDescription: Text[100];

    trigger OnRun()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        case ActionToRun of
            ActionToRun::Create:
                ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX144 Customer', 20270301D, 20270303D);
            ActionToRun::CheckOut:
                RentalMgt.CheckOut(ContractNo);
            ActionToRun::Return:
                RentalMgt.Return(ContractNo, ReturnKm, DamageDescription);
            ActionToRun::Post:
                RentalMgt.Post(ContractNo);
            ActionToRun::Delete:
                begin
                    Contract.Get(ContractNo);
                    Contract.Delete(true);
                end;
        end;
    end;

    procedure SetCreate(NewVehicleNo: Code[20])
    begin
        ActionToRun := ActionToRun::Create;
        VehicleNo := NewVehicleNo;
        ContractNo := '';
    end;

    procedure SetCheckOut(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::CheckOut;
        ContractNo := NewContractNo;
    end;

    procedure SetReturn(NewContractNo: Code[20]; NewReturnKm: Integer; NewDamageDescription: Text[100])
    begin
        ActionToRun := ActionToRun::Return;
        ContractNo := NewContractNo;
        ReturnKm := NewReturnKm;
        DamageDescription := NewDamageDescription;
    end;

    procedure SetPost(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::Post;
        ContractNo := NewContractNo;
    end;

    procedure SetDelete(NewContractNo: Code[20])
    begin
        ActionToRun := ActionToRun::Delete;
        ContractNo := NewContractNo;
    end;

    procedure CreatedContractNo(): Code[20]
    begin
        exit(ContractNo);
    end;
}
