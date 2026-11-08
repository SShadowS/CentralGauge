codeunit 70585 "CGR Vehicle Blocking"
{
    var
        RentedOutErr: Label 'Vehicle %1 is rented out.', Comment = '%1 = vehicle';
        DeleteContractsQst: Label 'Vehicle %1 has %2 open contracts. Delete them and block the vehicle?', Comment = '%1 = vehicle, %2 = number';
        OpenContractsErr: Label 'Vehicle %1 has open contracts. Block it from the vehicle card.', Comment = '%1 = vehicle';

    procedure BlockVehicle(VehicleNo: Code[20]; Reason: Text[100])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
    begin
        Vehicle.Get(VehicleNo);
        if Vehicle."Checked Out" then
            Error(RentedOutErr, VehicleNo);
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.SetRange(Status, Contract.Status::Open);
        if not Contract.IsEmpty() then begin
            if not GuiAllowed() then
                Error(OpenContractsErr, VehicleNo);
            if not Confirm(DeleteContractsQst, false, VehicleNo, Contract.Count()) then
                exit;
            Contract.DeleteAll(true);
        end;
        Vehicle.Blocked := true;
        Vehicle."Block Reason" := Reason;
        Vehicle.Modify(true);
        OnAfterBlockVehicle(Vehicle);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterBlockVehicle(Vehicle: Record "CGR Vehicle")
    begin
    end;
}
