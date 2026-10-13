codeunit 86140 "HX034 Return Import Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure AbsentDamageMeansNone()
    var
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        CreateHX34Rental('HX034-C01', 'HX034-V01');
        Runner.SetPayload('[' + HX34Element('HX034-C01', 1300, '') + ']');
        Commit();

        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'A return without a damage property is imported: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ImportedCount(), 'One contract returned');
        AssertHX34Returned('HX034-C01', 'HX034-V01', 1300, '');
    end;

    [Test]
    procedure NullDamageMeansNone()
    var
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        CreateHX34Rental('HX034-C02', 'HX034-V02');
        Runner.SetPayload('[' + HX34Element('HX034-C02', 1300, 'null') + ']');
        Commit();

        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'A return with a null damage is imported: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ImportedCount(), 'One contract returned');
        AssertHX34Returned('HX034-C02', 'HX034-V02', 1300, '');
    end;

    [Test]
    procedure EmptyDamageMeansNone()
    var
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        CreateHX34Rental('HX034-C03', 'HX034-V03');
        Runner.SetPayload('[' + HX34Element('HX034-C03', 1300, '""') + ']');
        Commit();

        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'A return with an empty damage is imported: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ImportedCount(), 'One contract returned');
        AssertHX34Returned('HX034-C03', 'HX034-V03', 1300, '');
    end;

    [Test]
    procedure DamageRegistered()
    var
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        CreateHX34Rental('HX034-C04', 'HX034-V04');
        Runner.SetPayload('[' + HX34Element('HX034-C04', 1300, '"Dent rear door"') + ']');
        Commit();

        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'A return with a reported damage is imported: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ImportedCount(), 'One contract returned');
        AssertHX34Returned('HX034-C04', 'HX034-V04', 1300, 'Dent rear door');
    end;

    [Test]
    procedure MixedPayload()
    var
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        CreateHX34Rental('HX034-C05A', 'HX034-V05A');
        CreateHX34Rental('HX034-C05B', 'HX034-V05B');
        CreateHX34Rental('HX034-C05C', 'HX034-V05C');
        Runner.SetPayload('[' + HX34Element('HX034-C05A', 1300, '') + ',' + HX34Element('HX034-C05B', 1400, 'null') + ',' + HX34Element('HX034-C05C', 1500, '"Scratch left wing"') + ']');
        Commit();

        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'A payload mixing the damage shapes is imported: ' + GetLastErrorText());
        Assert.AreEqual(3, Runner.ImportedCount(), 'Three contracts returned');
        AssertHX34Returned('HX034-C05A', 'HX034-V05A', 1300, '');
        AssertHX34Returned('HX034-C05B', 'HX034-V05B', 1400, '');
        AssertHX34Returned('HX034-C05C', 'HX034-V05C', 1500, 'Scratch left wing');
    end;

    [Test]
    procedure UnknownContractKeepsNothing()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        CreateHX34Rental('HX034-C06A', 'HX034-V06A');
        if Contract.Get('HX034-NONE') then
            Contract.Delete();
        Runner.SetPayload('[' + HX34Element('HX034-C06A', 1300, '""') + ',' + HX34Element('HX034-NONE', 1300, '""') + ']');
        Commit();

        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'A payload with an unknown contract fails');
        Assert.AreEqual('The CGR Rental Contract does not exist. Identification fields and values: No.=''HX034-NONE''', GetLastErrorText(), 'The error of the failing return reaches the caller');
        AssertHX34Untouched('HX034-C06A', 'HX034-V06A');
    end;

    [Test]
    procedure KmBelowStartKeepsNothing()
    var
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        CreateHX34Rental('HX034-C07A', 'HX034-V07A');
        CreateHX34Rental('HX034-C07B', 'HX034-V07B');
        Runner.SetPayload('[' + HX34Element('HX034-C07A', 1300, '""') + ',' + HX34Element('HX034-C07B', 900, '""') + ']');
        Commit();

        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'A payload with a return below the start km fails');
        Assert.AreEqual('Return km 900 is below the start km 1000.', GetLastErrorText(), 'The error of the failing return reaches the caller');
        AssertHX34Untouched('HX034-C07A', 'HX034-V07A');
        AssertHX34Untouched('HX034-C07B', 'HX034-V07B');
    end;

    [Test]
    procedure EmptyArrayImportsNothing()
    var
        Runner: Codeunit "HX034 Import Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        Runner.SetPayload('[]');
        Commit();

        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'An empty payload is imported: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.ImportedCount(), 'An empty array returns 0');
    end;

    local procedure CreateHX34Rental(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Checked Out" := true;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX034 Customer';
        Contract."Start Date" := 20270225D;
        Contract."End Date" := 20270228D;
        Contract.Status := Contract.Status::"Checked Out";
        Contract."Start Km" := 1000;
        Contract.Insert();
    end;

    local procedure HX34Element(ContractNo: Code[20]; ReturnKm: Integer; DamageJson: Text): Text
    var
        Element: Text;
    begin
        Element := StrSubstNo('{"contractNo": "%1", "returnKm": %2', ContractNo, Format(ReturnKm, 0, 9));
        if DamageJson <> '' then
            Element += ', "damage": ' + DamageJson;
        exit(Element + '}');
    end;

    local procedure AssertHX34Returned(ContractNo: Code[20]; VehicleNo: Code[20]; ReturnKm: Integer; Damage: Text[100])
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, ContractNo + ' is returned');
        Assert.AreEqual(ReturnKm, Contract."Return Km", ContractNo + ' return km');
        Assert.AreEqual(Damage, Contract."Damage Description", ContractNo + ' damage description');
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(ReturnKm, Vehicle.Mileage, VehicleNo + ' mileage is the return km');
        Assert.IsFalse(Vehicle."Checked Out", VehicleNo + ' is no longer checked out');
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        if Damage = '' then begin
            Assert.IsFalse(Vehicle.Blocked, VehicleNo + ' without damage is not blocked');
            Assert.AreEqual(0, Vehicle."Open Damages", VehicleNo + ' without damage has no open damage');
            Assert.AreEqual(0, DamageEntry.Count(), VehicleNo + ' without damage has no damage entry');
        end else begin
            Assert.IsTrue(Vehicle.Blocked, VehicleNo + ' with damage is blocked');
            Assert.AreEqual(1, Vehicle."Open Damages", VehicleNo + ' with damage has one open damage');
            Assert.AreEqual(1, DamageEntry.Count(), VehicleNo + ' with damage has one damage entry');
            DamageEntry.FindFirst();
            Assert.AreEqual(Damage, DamageEntry.Description, VehicleNo + ' damage entry description');
        end;
    end;

    local procedure AssertHX34Untouched(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, ContractNo + ' is still checked out');
        Assert.AreEqual(0, Contract."Return Km", ContractNo + ' keeps no return km');
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(1000, Vehicle.Mileage, VehicleNo + ' keeps its mileage');
        Assert.IsTrue(Vehicle."Checked Out", VehicleNo + ' is still checked out');
    end;
}
