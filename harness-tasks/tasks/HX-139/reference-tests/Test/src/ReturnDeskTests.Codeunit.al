codeunit 80470 "CGR Return Desk Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        CapturedMessage: Text;
        MessagesShown: Integer;

    [Test]
    procedure ExcessReturnWithoutUserInterfaceIsCharged()
    var
        Contract: Record "CGR Rental Contract";
        Charge: Record "CGR Return Excess Charge";
        Runner: Codeunit "CGR Return Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX139Prepare();
        ContractNo := HX139CheckedOutContract('HX139-E1');
        Runner.SetReturnRun(ContractNo, 1450);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The return is booked without a user interface: ' + GetLastErrorText());
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract is returned');
        Assert.AreEqual(1450, Contract."Return Km", 'The return km is stored');
        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Charge.Count(), 'Without a user interface the excess is always charged');
        Charge.FindFirst();
        Assert.AreEqual(150, Charge."Excess Km", 'Excess km = 450 driven - 3 days x 100');
        Assert.AreEqual(52.5, Charge.Amount, 'Amount = 150 excess km x 0.35');
    end;

    [Test]
    procedure ReturnAtAllowanceChargesNothing()
    var
        Contract: Record "CGR Rental Contract";
        Charge: Record "CGR Return Excess Charge";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
    begin
        HX139Prepare();
        ContractNo := HX139CheckedOutContract('HX139-A1');

        ReturnDesk.BookReturn(ContractNo, 1300);

        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract is returned');
        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Charge.Count(), 'Exactly 3 days x 100 km driven: nothing is charged');
    end;

    [Test]
    [HandlerFunctions('HX139MessageHandler')]
    procedure OpenDamagesAreReported()
    var
        Charge: Record "CGR Return Excess Charge";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
    begin
        HX139Prepare();
        CapturedMessage := '';
        MessagesShown := 0;
        Lib.CreateVehicle('HX139-D1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX139Damage('HX139-D1', false);
        HX139Damage('HX139-D1', false);
        HX139Damage('HX139-D1', true);
        ContractNo := HX139ContractFor('HX139-D1');

        ReturnDesk.BookReturn(ContractNo, 1100);

        Assert.AreEqual(1, MessagesShown, 'One open-damages message is shown');
        Assert.AreEqual('Vehicle HX139-D1 has 2 open damages. Inspect it before it is rented again.', CapturedMessage, 'The message counts the unrepaired damage entries only');
        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Charge.Count(), 'Within the allowance nothing is charged');
    end;

    [MessageHandler]
    procedure HX139MessageHandler(Message: Text[1024])
    begin
        CapturedMessage := Message;
        MessagesShown += 1;
    end;

    local procedure HX139Prepare()
    begin
        WorkDate(20250415D);
        Lib.SetPricing(0, 100, 0.35);
    end;

    local procedure HX139CheckedOutContract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(HX139ContractFor(VehicleNo));
    end;

    local procedure HX139ContractFor(VehicleNo: Code[20]): Code[20]
    var
        Charge: Record "CGR Return Excess Charge";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX139 Customer', 20250407D, 20250409D);
        RentalMgt.CheckOut(ContractNo);
        Charge.SetRange("Contract No.", ContractNo);
        Charge.DeleteAll();
        exit(ContractNo);
    end;

    local procedure HX139Damage(VehicleNo: Code[20]; IsRepaired: Boolean)
    var
        Damage: Record "CGR Damage Entry";
    begin
        Damage.Init();
        Damage."Vehicle No." := VehicleNo;
        Damage.Description := 'HX139 scratch';
        Damage."Reported On" := 20250401D;
        Damage.Repaired := IsRepaired;
        Damage.Insert();
    end;
}
