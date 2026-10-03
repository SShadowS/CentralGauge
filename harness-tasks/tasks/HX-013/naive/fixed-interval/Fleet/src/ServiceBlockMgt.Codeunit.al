codeunit 70112 "CGR Service Block Mgt"
{
    procedure BlockDueVehicles(var Vehicle: Record "CGR Vehicle"; AtDate: Date): Integer
    var
        DueVehicle: Record "CGR Vehicle";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        BlockedCount: Integer;
    begin
        if not Vehicle.FindSet() then
            exit(0);
        repeat
            if not Vehicle.Blocked and ServicePlanMgt.IsServiceDue(Vehicle."No.", AtDate) then begin
                DueVehicle.Get(Vehicle."No.");
                DueVehicle.Blocked := true;
                DueVehicle.Modify(true);
                BlockedCount += 1;
            end;
        until Vehicle.Next() = 0;
        exit(BlockedCount);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Service Plan Mgt", 'OnAfterServiceRegistered', '', false, false)]
    local procedure ReleaseServicedVehicle(var Vehicle: Record "CGR Vehicle")
    begin
        if not Vehicle.Blocked then
            exit;
        Vehicle.UpdateBlockedState(WorkDate());
        if not Vehicle.Blocked then
            Vehicle.Modify(true);
    end;
}
