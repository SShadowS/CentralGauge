codeunit 70226 "CGR Desk Inspection"
{
    SingleInstance = true;

    var
        Running: Boolean;

    procedure StartInspection(VehicleNos: List of [Code[20]])
    var
        Lending: Codeunit "CGR Inspection Lending";
    begin
        Lending.SetVehicles(VehicleNos);
        BindSubscription(Lending);
        Running := true;
    end;

    procedure EndInspection()
    begin
        Running := false;
    end;

    procedure IsInspectionRunning(): Boolean
    begin
        exit(Running);
    end;

    procedure CheckOutForInspection(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        VehicleNos: List of [Code[20]];
    begin
        Contract.Get(ContractNo);
        VehicleNos.Add(Contract."Vehicle No.");
        StartInspection(VehicleNos);
        RentalMgt.CheckOut(ContractNo);
        EndInspection();
    end;
}
