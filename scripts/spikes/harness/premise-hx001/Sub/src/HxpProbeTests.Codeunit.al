// SPIKE (throwaway): harness bench M4-00 premise probe
// Every test ends in Error: RESULTS-<flow> NO-ERROR <final state>, or the platform error text if the flow raised one.
codeunit 50160 "HXP Probe Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    [Test]
    procedure ProbeStaleOtherApp()
    var
        Flows: Codeunit "HXP Flows";
    begin
        Setup('HX001');
        Flows.StaleOtherApp('HX001');
        Report('StaleOtherApp', 'HX001');
    end;

    [Test]
    procedure ProbeStaleSameApp()
    var
        Flows: Codeunit "HXP Flows";
    begin
        Setup('HX002');
        Flows.StaleSameApp('HX002');
        Report('StaleSameApp', 'HX002');
    end;

    [Test]
    procedure ProbeStaleLockTable()
    var
        Flows: Codeunit "HXP Flows";
    begin
        Setup('HX003');
        Flows.StaleLockTable('HX003');
        Report('StaleLockTable', 'HX003');
    end;

    [Test]
    procedure ProbeRegetAfterEvent()
    var
        Flows: Codeunit "HXP Flows";
    begin
        Setup('HX004');
        Flows.RegetAfterEvent('HX004');
        Report('RegetAfterEvent', 'HX004');
    end;

    [Test]
    procedure ProbeFindEqAfterEvent()
    var
        Flows: Codeunit "HXP Flows";
    begin
        Setup('HX005');
        Flows.FindEqAfterEvent('HX005');
        Report('FindEqAfterEvent', 'HX005');
    end;

    [Test]
    procedure ProbeByVar()
    var
        Flows: Codeunit "HXP Flows";
    begin
        Setup('HX006');
        Flows.ByVar('HX006');
        Report('ByVar', 'HX006');
    end;

    [Test]
    procedure ProbeModifyBeforeEvent()
    var
        Flows: Codeunit "HXP Flows";
    begin
        Setup('HX007');
        Flows.ModifyBeforeEvent('HX007');
        Report('ModifyBeforeEvent', 'HX007');
    end;

    local procedure Setup(VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
    begin
        if V.Get(VehicleNo) then
            V.Delete();
        V.Init();
        V."No." := VehicleNo;
        V.Mileage := 100;
        V."Checked Out" := true;
        V.Blocked := false;
        V.Insert();
    end;

    local procedure Report(Flow: Text; VehicleNo: Code[20])
    var
        V: Record "HXP Vehicle";
    begin
        V.Get(VehicleNo);
        Error('RESULTS-%1 NO-ERROR Blocked=%2 CheckedOut=%3 Mileage=%4', Flow, V.Blocked, V."Checked Out", V.Mileage);
    end;
}
