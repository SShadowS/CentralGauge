codeunit 70111 "CGR Service Plan Mgt"
{
    var
        ServiceKmErr: Label 'Service km %1 is above the mileage %2 of vehicle %3.', Comment = '%1 = service km, %2 = mileage, %3 = vehicle number';

    procedure AssignPlan(VehicleNo: Code[20]; PlanCode: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlan: Record "CGR Service Plan";
    begin
        ServicePlan.Get(PlanCode);
        Vehicle.Get(VehicleNo);
        Vehicle."Service Plan Code" := ServicePlan.Code;
        Vehicle.Strategy := ServicePlan.Strategy;
        Vehicle.Modify(true);
    end;

    procedure RegisterService(VehicleNo: Code[20]; ServiceDate: Date; ServiceKm: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        ServiceVisit: Record "CGR Service Visit";
    begin
        Vehicle.Get(VehicleNo);
        if ServiceKm > Vehicle.Mileage then
            Error(ServiceKmErr, Format(ServiceKm, 0, 9), Format(Vehicle.Mileage, 0, 9), VehicleNo);
        Vehicle."Last Service Km" := ServiceKm;
        Vehicle."Last Service Date" := ServiceDate;
        Vehicle.Modify(true);

        ServiceVisit.Init();
        ServiceVisit."Vehicle No." := VehicleNo;
        ServiceVisit."Service Plan Code" := Vehicle."Service Plan Code";
        ServiceVisit."Service Date" := ServiceDate;
        ServiceVisit."Service Km" := ServiceKm;
        ServiceVisit.Insert(true);

        OnAfterServiceRegistered(Vehicle);
    end;

    procedure ChangePlanCode(OldCode: Code[20]; NewCode: Code[20])
    var
        ServicePlan: Record "CGR Service Plan";
        ServiceVisit: Record "CGR Service Visit";
        PlanExistsErr: Label 'Service plan %1 already exists.', Comment = '%1 = service plan code';
    begin
        if ServicePlan.Get(NewCode) then
            Error(PlanExistsErr, NewCode);
        ServicePlan.Get(OldCode);
        ServicePlan.Rename(NewCode);
        ServiceVisit.SetRange("Service Plan Code", OldCode);
        ServiceVisit.ModifyAll("Service Plan Code", NewCode);
    end;

    procedure NextServiceDate(VehicleNo: Code[20]): Date
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlan: Record "CGR Service Plan";
    begin
        Vehicle.Get(VehicleNo);
        if (Vehicle."Service Plan Code" = '') or (Vehicle."Last Service Date" = 0D) then
            exit(0D);
        ServicePlan.Get(Vehicle."Service Plan Code");
        if ServicePlan."Interval Months" = 0 then
            exit(0D);
        exit(CalcDate(StrSubstNo('<+%1M>', ServicePlan."Interval Months"), Vehicle."Last Service Date"));
    end;

    procedure IsServiceDue(VehicleNo: Code[20]; AtDate: Date): Boolean
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        DueDate: Date;
    begin
        Vehicle.Get(VehicleNo);
        if Vehicle.Mileage >= FleetMgt.NextServiceKm(VehicleNo) then
            exit(true);
        DueDate := NextServiceDate(VehicleNo);
        exit((DueDate <> 0D) and (AtDate >= DueDate));
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterServiceRegistered(var Vehicle: Record "CGR Vehicle")
    begin
    end;
}
