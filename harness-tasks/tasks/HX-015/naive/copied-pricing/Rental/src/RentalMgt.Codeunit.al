codeunit 70200 "CGR Rental Mgt"
{
    var
        NotAvailableErr: Label 'Vehicle %1 is not available.', Comment = '%1 = vehicle number';
        WrongStatusErr: Label 'Rental contract %1 must have status %2.', Comment = '%1 = contract number, %2 = status';
        ReturnKmErr: Label 'Return km %1 is below the start km %2.', Comment = '%1 = return km, %2 = start km';
        NotReturnedErr: Label 'Rental contract %1 must be returned before it is posted.', Comment = '%1 = contract number';

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
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::"Checked Out" then
            Error(WrongStatusErr, ContractNo, Contract.Status::"Checked Out");
        NewVehicle.Get(NewVehicleNo);
        if NewVehicle."Checked Out" or NewVehicle.Blocked then
            Error(NotAvailableErr, NewVehicleNo);
        if OldVehicle.Get(Contract."Vehicle No.") then begin
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

    procedure PreviewPosting(ContractNo: Code[20]; var LedgerBuffer: Record "CGR Rental Ledger Entry" temporary)
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        AmountRounding: Codeunit "CGR Amount Rounding";
        PostLedger: Codeunit "CGR Rental-Post Ledger";
        Days: Integer;
        WeekendDays: Integer;
        Driven: Integer;
        Allowed: Integer;
        i: Integer;
        Total: Decimal;
    begin
        LedgerBuffer.Reset();
        LedgerBuffer.DeleteAll();
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Returned then
            Error(NotReturnedErr, ContractNo);
        Vehicle.Get(Contract."Vehicle No.");
        SessionContext.GetSetup(Setup);
        Days := Contract."End Date" - Contract."Start Date" + 1;
        if Contract."Pricing Method" = Contract."Pricing Method"::"Weekend Package" then
            Total := 2 * Vehicle."Daily Rate"
        else begin
            Total := Days * Vehicle."Daily Rate";
            for i := 0 to Days - 1 do
                if Date2DWY(Contract."Start Date" + i, 1) in [6, 7] then
                    WeekendDays += 1;
            Total += WeekendDays * Vehicle."Daily Rate" * Setup."Weekend Surcharge %" / 100;
        end;
        Driven := Contract."Return Km" - Contract."Start Km";
        Allowed := Days * Setup."Km Allowance per Day";
        if Driven > Allowed then
            Total += (Driven - Allowed) * Setup."Excess Km Rate";
        PostLedger.BuildEntry(Contract, AmountRounding.RoundAmount(Total), LedgerBuffer);
        LedgerBuffer.Insert();
    end;
}
