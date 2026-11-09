codeunit 88377 "HX161 Create Runner"
{
    var
        RunMode: Option CheckOnly,Create,CallerRow,CallerFails;
        RunCustomer: Text[100];
        RunResult: Boolean;
        RunContractNo: Code[20];

    procedure SetCheckHX161(CustomerName: Text[100])
    begin
        RunMode := RunMode::CheckOnly;
        RunCustomer := CustomerName;
    end;

    procedure SetCreateHX161(CustomerName: Text[100])
    begin
        RunMode := RunMode::Create;
        RunCustomer := CustomerName;
    end;

    procedure SetCallerRowHX161(CustomerName: Text[100])
    begin
        RunMode := RunMode::CallerRow;
        RunCustomer := CustomerName;
    end;

    procedure SetCallerFailsHX161(CustomerName: Text[100])
    begin
        RunMode := RunMode::CallerFails;
        RunCustomer := CustomerName;
    end;

    procedure ResultHX161(): Boolean
    begin
        exit(RunResult);
    end;

    procedure ContractNoHX161(): Code[20]
    begin
        exit(RunContractNo);
    end;

    trigger OnRun()
    var
        CreditCheck: Codeunit "CGR Credit Check";
    begin
        case RunMode of
            RunMode::CheckOnly:
                RunResult := CreditCheck.CheckCustomer(RunCustomer);
            RunMode::Create:
                CreateHX161();
            RunMode::CallerRow:
                begin
                    InsertCallerRowHX161();
                    CreateHX161();
                end;
            RunMode::CallerFails:
                begin
                    InsertCallerRowHX161();
                    CreateHX161();
                    FailHX161();
                end;
        end;
    end;

    local procedure CreateHX161()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RunContractNo := RentalMgt.CreateContract('HX161-V1', RunCustomer, 20250301D, 20250305D);
    end;

    local procedure InsertCallerRowHX161()
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := 'HX161-CALLER';
        Vehicle.Insert();
    end;

    local procedure FailHX161()
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(RunContractNo);
        if Contract."Credit Approved" then
            Error('HX161 import failed after an approved contract');
        Error('HX161 import failed after an unapproved contract');
    end;
}
