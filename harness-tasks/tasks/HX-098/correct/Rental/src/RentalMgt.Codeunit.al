codeunit 70200 "CGR Rental Mgt"
{
    var
        NotAvailableErr: Label 'Vehicle %1 is not available.', Comment = '%1 = vehicle number';
        WrongStatusErr: Label 'Rental contract %1 must have status %2.', Comment = '%1 = contract number, %2 = status';
        ReturnKmErr: Label 'Return km %1 is below the start km %2.', Comment = '%1 = return km, %2 = start km';
        LicenceClassErr: Label 'Rental contract %1 needs driving licence class C or CE for van %2.', Comment = '%1 = contract number, %2 = vehicle number';
        BoatLicenceErr: Label 'Rental contract %1 needs the customer''s boat licence for boat %2.', Comment = '%1 = contract number, %2 = vehicle number';
        HarbourErr: Label 'Boat %1 can only be handed out at a harbour branch, not at branch %2.', Comment = '%1 = vehicle number, %2 = branch code';
        SwapKindErr: Label 'Rental contract %1 cannot move from %2 to %3: a rental never moves between a boat and a road vehicle.', Comment = '%1 = contract number, %2 = current vehicle, %3 = new vehicle';

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
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Open then
            Error(WrongStatusErr, ContractNo, Contract.Status::Open);
        if not FleetMgt.IsAvailable(Contract."Vehicle No.") then
            Error(NotAvailableErr, Contract."Vehicle No.");
        Vehicle.Get(Contract."Vehicle No.");
        case Vehicle."Asset Type" of
            Vehicle."Asset Type"::Van:
                if not (Contract."Driving Licence Class" in ['C', 'CE']) then
                    Error(LicenceClassErr, ContractNo, Vehicle."No.");
            Vehicle."Asset Type"::Boat:
                begin
                    if Contract."Boat Licence No." = '' then
                        Error(BoatLicenceErr, ContractNo, Vehicle."No.");
                    if not IsHarbourBranch(Contract."Branch Code") then
                        Error(HarbourErr, Vehicle."No.", Contract."Branch Code");
                end;
        end;
        Contract."Start Km" := Vehicle.Mileage;
        Contract.Status := Contract.Status::"Checked Out";
        Contract.Modify(true);
        CoreEvents.RaiseVehicleCheckedOut(Contract."Vehicle No.");
    end;

    procedure SwapVehicle(ContractNo: Code[20]; NewVehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        OldVehicle: Record "CGR Vehicle";
        NewVehicle: Record "CGR Vehicle";
        HasOldVehicle: Boolean;
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::"Checked Out" then
            Error(WrongStatusErr, ContractNo, Contract.Status::"Checked Out");
        NewVehicle.Get(NewVehicleNo);
        if NewVehicle."Checked Out" or NewVehicle.Blocked then
            Error(NotAvailableErr, NewVehicleNo);
        HasOldVehicle := OldVehicle.Get(Contract."Vehicle No.");
        if HasOldVehicle then
            if IsBoat(OldVehicle) <> IsBoat(NewVehicle) then
                Error(SwapKindErr, ContractNo, OldVehicle."No.", NewVehicleNo);
        if HasOldVehicle then begin
            OldVehicle."Checked Out" := false;
            OldVehicle.Modify(true);
        end;
        NewVehicle."Checked Out" := true;
        NewVehicle.Modify(true);
        Contract."Vehicle No." := NewVehicleNo;
        Contract."Start Km" := NewVehicle.Mileage;
        Contract.Modify(true);
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

    local procedure IsHarbourBranch(BranchCode: Code[10]): Boolean
    var
        Branch: Record "CGR Branch";
    begin
        if not Branch.Get(BranchCode) then
            exit(false);
        exit(Branch.Harbour);
    end;

    local procedure IsBoat(Vehicle: Record "CGR Vehicle"): Boolean
    begin
        exit(Vehicle."Asset Type" = Vehicle."Asset Type"::Boat);
    end;
}
