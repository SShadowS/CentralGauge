codeunit 87060 "HX080 Service Dates Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure WindowBoundsInclusive()
    var
        DateReport: Codeunit "CGR Service Date Report";
        VehicleNos: List of [Code[20]];
    begin
        HX080Prepare();
        HX080SeedAll('1');

        Assert.AreEqual(3, DateReport.ListServicedBetween(20270301D, 20270331D, VehicleNos), 'Vehicles serviced from 2027-03-01 to 2027-03-31');
        Assert.AreEqual(3, VehicleNos.Count(), 'Listed vehicles');
        HX080AssertListed(VehicleNos, 'HX080-1A');
        HX080AssertListed(VehicleNos, 'HX080-1B');
        HX080AssertListed(VehicleNos, 'HX080-1C');
        HX080AssertNotListed(VehicleNos, 'HX080-1D');
        HX080AssertNotListed(VehicleNos, 'HX080-1E');
        HX080AssertNotListed(VehicleNos, 'HX080-1N');
        Assert.AreEqual(70521, Codeunit::"CGR Service Date Report", 'CGR Service Date Report is codeunit 70521');
    end;

    [Test]
    procedure OpenStartSkipsNeverServiced()
    var
        DateReport: Codeunit "CGR Service Date Report";
        VehicleNos: List of [Code[20]];
    begin
        HX080Prepare();
        HX080SeedAll('2');

        Assert.AreEqual(4, DateReport.ListServicedBetween(0D, 20270331D, VehicleNos), 'Vehicles serviced up to 2027-03-31');
        Assert.AreEqual(4, VehicleNos.Count(), 'Listed vehicles');
        HX080AssertListed(VehicleNos, 'HX080-2D');
        HX080AssertListed(VehicleNos, 'HX080-2A');
        HX080AssertListed(VehicleNos, 'HX080-2B');
        HX080AssertListed(VehicleNos, 'HX080-2C');
        HX080AssertNotListed(VehicleNos, 'HX080-2N');
        HX080AssertNotListed(VehicleNos, 'HX080-2E');
    end;

    [Test]
    procedure ListReplaced()
    var
        DateReport: Codeunit "CGR Service Date Report";
        VehicleNos: List of [Code[20]];
    begin
        HX080Prepare();
        HX080AddVehicle('HX080-3A', 20270301D, 'HX080-P');
        HX080AddVehicle('HX080-3B', 20270315D, '');
        HX080AddVehicle('HX080-3C', 20270331D, 'HX080-P');
        HX080AddVehicle('HX080-3N', 0D, '');
        VehicleNos.Add('HX080-OLD');
        Assert.AreEqual(1, VehicleNos.Count(), 'Precondition: the list holds an earlier entry');

        Assert.AreEqual(2, DateReport.ListServicedBetween(20270301D, 20270315D, VehicleNos), 'Vehicles serviced from 2027-03-01 to 2027-03-15');
        Assert.AreEqual(2, VehicleNos.Count(), 'The list holds only the vehicles of this call');
        HX080AssertListed(VehicleNos, 'HX080-3A');
        HX080AssertListed(VehicleNos, 'HX080-3B');
        HX080AssertNotListed(VehicleNos, 'HX080-OLD');
        HX080AssertNotListed(VehicleNos, 'HX080-3C');
    end;

    [Test]
    procedure SingleDayWindow()
    var
        DateReport: Codeunit "CGR Service Date Report";
        VehicleNos: List of [Code[20]];
    begin
        HX080Prepare();
        HX080AddVehicle('HX080-4A', 20270301D, 'HX080-P');
        HX080AddVehicle('HX080-4B', 20270315D, '');
        HX080AddVehicle('HX080-4C', 20270331D, 'HX080-P');
        HX080AddVehicle('HX080-4N', 0D, '');

        Assert.AreEqual(1, DateReport.ListServicedBetween(20270315D, 20270315D, VehicleNos), 'Vehicles serviced on 2027-03-15');
        Assert.AreEqual(1, VehicleNos.Count(), 'Listed vehicles');
        HX080AssertListed(VehicleNos, 'HX080-4B');
    end;

    [Test]
    procedure EmptyWindowClearsList()
    var
        DateReport: Codeunit "CGR Service Date Report";
        VehicleNos: List of [Code[20]];
    begin
        HX080Prepare();
        HX080AddVehicle('HX080-5A', 20270301D, 'HX080-P');
        HX080AddVehicle('HX080-5B', 20270315D, '');
        HX080AddVehicle('HX080-5N', 0D, '');
        VehicleNos.Add('HX080-5A');
        Assert.AreEqual(1, VehicleNos.Count(), 'Precondition: the list holds an earlier entry');

        Assert.AreEqual(0, DateReport.ListServicedBetween(20260101D, 20261231D, VehicleNos), 'No vehicle was serviced in 2026');
        Assert.AreEqual(0, VehicleNos.Count(), 'The list is empty');
    end;

    [Test]
    procedure QueryFilterElement()
    var
        ServiceDates: Query "CGR Service Date List";
        SeenA: Integer;
        SeenB: Integer;
        SeenC: Integer;
        Rows: Integer;
    begin
        HX080Prepare();
        HX080SeedAll('6');

        ServiceDates.SetRange(ServiceDateFilter, 20270301D, 20270331D);
        ServiceDates.Open();
        while ServiceDates.Read() do begin
            Rows += 1;
            case ServiceDates.VehicleNo of
                'HX080-6A':
                    begin
                        SeenA += 1;
                        Assert.AreEqual(20270301D, ServiceDates.LastServiceDate, 'Last service date of HX080-6A');
                        Assert.AreEqual('HX080-P', ServiceDates.ServicePlanCode, 'Service plan of HX080-6A');
                    end;
                'HX080-6B':
                    begin
                        SeenB += 1;
                        Assert.AreEqual(20270315D, ServiceDates.LastServiceDate, 'Last service date of HX080-6B');
                        Assert.AreEqual('', ServiceDates.ServicePlanCode, 'Service plan of HX080-6B');
                    end;
                'HX080-6C':
                    begin
                        SeenC += 1;
                        Assert.AreEqual(20270331D, ServiceDates.LastServiceDate, 'Last service date of HX080-6C');
                        Assert.AreEqual('HX080-P', ServiceDates.ServicePlanCode, 'Service plan of HX080-6C');
                    end;
                else
                    Assert.Fail(StrSubstNo('Vehicle %1 is outside the service date filter', ServiceDates.VehicleNo));
            end;
        end;
        ServiceDates.Close();
        Assert.AreEqual(3, Rows, 'Rows inside the service date filter');
        Assert.AreEqual(1, SeenA, 'HX080-6A is read once');
        Assert.AreEqual(1, SeenB, 'HX080-6B is read once');
        Assert.AreEqual(1, SeenC, 'HX080-6C is read once');
        Assert.AreEqual(70520, Query::"CGR Service Date List", 'CGR Service Date List is query 70520');
    end;

    local procedure HX080SeedAll(RowTag: Text[1])
    begin
        HX080AddVehicle('HX080-' + RowTag + 'A', 20270301D, 'HX080-P');
        HX080AddVehicle('HX080-' + RowTag + 'B', 20270315D, '');
        HX080AddVehicle('HX080-' + RowTag + 'C', 20270331D, 'HX080-P');
        HX080AddVehicle('HX080-' + RowTag + 'D', 20270228D, '');
        HX080AddVehicle('HX080-' + RowTag + 'E', 20270401D, '');
        HX080AddVehicle('HX080-' + RowTag + 'N', 0D, '');
    end;

    local procedure HX080AddVehicle(VehicleNo: Code[20]; LastServiceDate: Date; PlanCode: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Last Service Date" := LastServiceDate;
        Vehicle."Service Plan Code" := PlanCode;
        Vehicle.Insert();
    end;

    local procedure HX080AssertListed(var VehicleNos: List of [Code[20]]; VehicleNo: Code[20])
    begin
        Assert.IsTrue(VehicleNos.Contains(VehicleNo), StrSubstNo('%1 is listed', VehicleNo));
    end;

    local procedure HX080AssertNotListed(var VehicleNos: List of [Code[20]]; VehicleNo: Code[20])
    begin
        Assert.IsFalse(VehicleNos.Contains(VehicleNo), StrSubstNo('%1 is not listed', VehicleNo));
    end;

    local procedure HX080Prepare()
    var
        Setup: Record "CGR Setup";
        Vehicle: Record "CGR Vehicle";
        ServicePlan: Record "CGR Service Plan";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();

        Vehicle.DeleteAll();
        if ServicePlan.Get('HX080-P') then
            ServicePlan.Delete();
        ServicePlan.Init();
        ServicePlan.Code := 'HX080-P';
        ServicePlan.Description := 'HX080 plan';
        ServicePlan."Interval Months" := 12;
        ServicePlan.Insert();
    end;
}
