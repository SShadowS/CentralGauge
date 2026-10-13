codeunit 70226 "CGR Desk Inspection"
{
    procedure StartInspection(VehicleNos: List of [Code[20]])
    var
        Lending: Codeunit "CGR Inspection Lending";
    begin
        if not Lending.IsRunning() then
            BindSubscription(Lending);
        Lending.SetVehicles(VehicleNos);
    end;

    procedure EndInspection()
    var
        Lending: Codeunit "CGR Inspection Lending";
    begin
        UnbindSubscription(Lending);
        Lending.StopLending();
    end;

    procedure IsInspectionRunning(): Boolean
    var
        Lending: Codeunit "CGR Inspection Lending";
    begin
        exit(Lending.IsRunning());
    end;

    procedure CheckOutForInspection(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Lending: Codeunit "CGR Inspection Lending";
        RentalMgt: Codeunit "CGR Rental Mgt";
        VehicleNos: List of [Code[20]];
    begin
        Contract.Get(ContractNo);
        VehicleNos.Add(Contract."Vehicle No.");
        if ContractNo = '' then
            StartInspection(VehicleNos);
        Lending.SetVehicles(VehicleNos);
        BindSubscription(Lending);
        RentalMgt.CheckOut(ContractNo);
        UnbindSubscription(Lending);
        Lending.StopLending();
    end;
}
