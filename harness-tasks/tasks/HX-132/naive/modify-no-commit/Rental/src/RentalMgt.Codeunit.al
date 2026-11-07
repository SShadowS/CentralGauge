codeunit 70200 "CGR Rental Mgt"
{
    var
        NotAvailableErr: Label 'Vehicle %1 is not available.', Comment = '%1 = vehicle number';
        WrongStatusErr: Label 'Rental contract %1 must have status %2.', Comment = '%1 = contract number, %2 = status';
        ReturnKmErr: Label 'Return km %1 is below the start km %2.', Comment = '%1 = return km, %2 = start km';

    procedure CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; EndDate: Date): Code[20]
    var
        Contract: Record "CGR Rental Contract";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Contract.Init();
        Contract."No." := Setup.NextContractNo();
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := CustomerName;
        Contract."Start Date" := StartDate;
        Contract."End Date" := EndDate;
        Contract.Status := Contract.Status::Open;
        Contract."Branch Code" := SessionContext.CurrentBranch();
        Contract.Insert(true);
        exit(Contract."No.");
    end;

    procedure CheckOut(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        CoreEvents: Codeunit "CGR Core Events";
        AuthCode: Text[50];
        Amount: Decimal;
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Open then
            Error(WrongStatusErr, ContractNo, Contract.Status::Open);

        Amount := ExpectedAmount(Contract);
        if (Contract."Payment Auth Code" = '') or (Contract."Authorized Amount" <> Amount) then begin
            OnRequestPreAuthorization(Contract, Amount, AuthCode);
            Contract."Payment Auth Code" := AuthCode;
            Contract."Authorized Amount" := Amount;
            Contract.Modify(true);
        end;

        if not FleetMgt.IsAvailable(Contract."Vehicle No.") then
            Error(NotAvailableErr, Contract."Vehicle No.");
        Vehicle.Get(Contract."Vehicle No.");
        Contract."Start Km" := Vehicle.Mileage;
        Contract.Status := Contract.Status::"Checked Out";
        Contract.Modify(true);
        CoreEvents.RaiseVehicleCheckedOut(Contract."Vehicle No.");
        OnAfterCheckOut(Contract);
    end;

    procedure SwapVehicle(ContractNo: Code[20]; NewVehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Priced: Record "CGR Rental Contract";
        OldVehicle: Record "CGR Vehicle";
        NewVehicle: Record "CGR Vehicle";
        OldVehicleNo: Code[20];
        OldAuthCode: Text[50];
        AuthCode: Text[50];
        NewAmount: Decimal;
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::"Checked Out" then
            Error(WrongStatusErr, ContractNo, Contract.Status::"Checked Out");
        NewVehicle.Get(NewVehicleNo);
        OldVehicleNo := Contract."Vehicle No.";
        Priced := Contract;
        Priced."Vehicle No." := NewVehicleNo;
        NewAmount := ExpectedAmount(Priced);
        if NewAmount > Contract."Authorized Amount" then begin
            if (Contract."Pending Auth Code" = '') or (Contract."Pending Auth Amount" <> NewAmount) then begin
                OnRequestPreAuthorization(Priced, NewAmount, AuthCode);
                Contract."Pending Auth Code" := AuthCode;
                Contract."Pending Auth Amount" := NewAmount;
                Contract.Modify(true);
            end;
            OldAuthCode := Contract."Payment Auth Code";
            Contract."Payment Auth Code" := Contract."Pending Auth Code";
            Contract."Authorized Amount" := Contract."Pending Auth Amount";
            Contract."Pending Auth Code" := '';
            Contract."Pending Auth Amount" := 0;
        end;
        if NewVehicle."Checked Out" or NewVehicle.Blocked then
            Error(NotAvailableErr, NewVehicleNo);
        if OldVehicle.Get(OldVehicleNo) then begin
            OldVehicle."Checked Out" := false;
            OldVehicle.Modify(true);
        end;
        NewVehicle."Checked Out" := true;
        NewVehicle.Modify(true);
        Contract."Vehicle No." := NewVehicleNo;
        Contract."Start Km" := NewVehicle.Mileage;
        Contract.Modify(true);
        OnAfterSwapVehicle(Contract);
        if OldAuthCode <> '' then
            OnReleasePreAuthorization(OldAuthCode); // provider side, never rolled back: only after everything that can fail
    end;

    procedure Return(ContractNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Contract: Record "CGR Rental Contract";
        CoreEvents: Codeunit "CGR Core Events";
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::"Checked Out" then
            Error(WrongStatusErr, ContractNo, Contract.Status::"Checked Out");
        if ReturnKm < Contract."Start Km" then
            Error(ReturnKmErr, Format(ReturnKm, 0, 9), Format(Contract."Start Km", 0, 9));
        Contract."Return Km" := ReturnKm;
        Contract."Damage Description" := DamageDescription;
        Contract.Status := Contract.Status::Returned;
        Contract.Modify(true);
        CoreEvents.RaiseVehicleReturned(Contract."Vehicle No.", ReturnKm, DamageDescription);
    end;

    procedure Post(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        Codeunit.Run(Codeunit::"CGR Rental-Post", Contract);
    end;

    procedure ExpectedAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        exit(Pricing.CalcAmount(Contract));
    end;

    [IntegrationEvent(false, false)]
    local procedure OnRequestPreAuthorization(Contract: Record "CGR Rental Contract"; Amount: Decimal; var AuthCode: Text[50])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnReleasePreAuthorization(AuthCode: Text[50])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCheckOut(var Contract: Record "CGR Rental Contract")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterSwapVehicle(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
