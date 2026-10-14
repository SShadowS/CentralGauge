codeunit 70226 "CGR Desk Inspection"
{
    procedure CheckOutForInspection(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Lending: Codeunit "CGR Inspection Lending";
        RentalMgt: Codeunit "CGR Rental Mgt";
        VehicleNos: List of [Code[20]];
    begin
        Contract.Get(ContractNo);
        VehicleNos.Add(Contract."Vehicle No.");
        Lending.SetVehicles(VehicleNos);
        BindSubscription(Lending);
        RentalMgt.CheckOut(ContractNo);
        UnbindSubscription(Lending);
    end;
}
