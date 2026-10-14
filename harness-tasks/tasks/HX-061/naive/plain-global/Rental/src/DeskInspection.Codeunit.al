codeunit 70226 "CGR Desk Inspection"
{
    var
        Lending: Codeunit "CGR Inspection Lending";
        Running: Boolean;

    procedure StartInspection(VehicleNos: List of [Code[20]])
    begin
        if not Running then
            BindSubscription(Lending);
        Lending.SetVehicles(VehicleNos);
        Running := true;
    end;

    procedure EndInspection()
    var
        NoVehicles: List of [Code[20]];
    begin
        if Running then
            UnbindSubscription(Lending);
        Lending.SetVehicles(NoVehicles);
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
