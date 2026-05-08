codeunit 80034 "CG-AL-M034 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Demo: Codeunit "CG SACF Demo";

    [Test]
    procedure TestSetAutoCalcFieldsPopulatesFlowField()
    var
        Parent: Record "CG SACF Parent";
        Child: Record "CG SACF Child";
        Total: Decimal;
    begin
        // Setup: clear tables
        Parent.DeleteAll();
        Child.DeleteAll();

        // Seed: parent P1 with three children summing to 600
        Parent.Init();
        Parent."No." := 'P1';
        Parent.Description := 'Parent for SetAutoCalcFields test';
        Parent.Insert();

        Child.Init();
        Child."Parent No." := 'P1';
        Child.Amount := 100;
        Child.Insert(true);

        Child.Init();
        Child."Parent No." := 'P1';
        Child.Amount := 200;
        Child.Insert(true);

        Child.Init();
        Child."Parent No." := 'P1';
        Child.Amount := 300;
        Child.Insert(true);

        // Act: read through RecordRef with SetAutoCalcFields
        Total := Demo.GetParentTotalViaRef('P1');

        // Assert: FlowField was auto-calculated to 600
        Assert.AreEqual(600, Total, 'SetAutoCalcFields on RecordRef should auto-populate the FlowField sum');

        // Cleanup
        Child.DeleteAll();
        Parent.DeleteAll();
    end;

    [Test]
    procedure TestSetAutoCalcFieldsZeroChildren()
    var
        Parent: Record "CG SACF Parent";
        Child: Record "CG SACF Child";
        Total: Decimal;
    begin
        Parent.DeleteAll();
        Child.DeleteAll();

        Parent.Init();
        Parent."No." := 'P2';
        Parent.Description := 'Parent with no children';
        Parent.Insert();

        Total := Demo.GetParentTotalViaRef('P2');

        Assert.AreEqual(0, Total, 'Parent with no children should yield Total Amount = 0');

        Parent.DeleteAll();
    end;
}
