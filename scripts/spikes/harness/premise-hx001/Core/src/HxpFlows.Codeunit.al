// SPIKE (throwaway): harness bench M4-00 premise probe
// Each flow: read vehicle into V, raise an event whose subscriber sets Blocked through its own
// record variable (or the passed var), then change V and call V.Modify(true).
codeunit 50102 "HXP Flows"
{
    procedure StaleOtherApp(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
        Events: Codeunit "HXP Events";
    begin
        V.Get(VehicleNo);
        Events.RaiseOtherApp(VehicleNo);
        Finish(V);
    end;

    procedure StaleSameApp(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
        Events: Codeunit "HXP Events";
    begin
        V.Get(VehicleNo);
        Events.RaiseSameApp(VehicleNo);
        Finish(V);
    end;

    procedure StaleLockTable(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
        Events: Codeunit "HXP Events";
    begin
        V.LockTable();
        V.Get(VehicleNo);
        Events.RaiseOtherApp(VehicleNo);
        Finish(V);
    end;

    procedure RegetAfterEvent(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
        Events: Codeunit "HXP Events";
    begin
        V.Get(VehicleNo);
        Events.RaiseOtherApp(VehicleNo);
        V.Get(VehicleNo);
        Finish(V);
    end;

    procedure FindEqAfterEvent(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
        Events: Codeunit "HXP Events";
    begin
        V.Get(VehicleNo);
        Events.RaiseOtherApp(VehicleNo);
        V.Find('=');
        Finish(V);
    end;

    procedure ByVar(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
        Events: Codeunit "HXP Events";
    begin
        V.Get(VehicleNo);
        Events.RaiseByVar(V);
        Finish(V);
    end;

    procedure ModifyBeforeEvent(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
        Events: Codeunit "HXP Events";
    begin
        // HX-001 "correct" ordering: own Modify first, then the event.
        V.Get(VehicleNo);
        V."Checked Out" := false;
        V.Mileage := 500;
        V.Modify(true);
        Events.RaiseOtherApp(VehicleNo);
    end;

    local procedure Finish(var V: Record "HXP Vehicle")
    begin
        V."Checked Out" := false;
        V.Mileage := 500;
        V.Modify(true);
    end;
}
