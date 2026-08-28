codeunit 70953 "CG X135 Order Lifecycle"
{
    procedure Release(var Order: Record "CG X135 Order")
    begin
        Order.TestField(Status, Order.Status::Open);
        Order.Status := Order.Status::Released;
        Order.Modify();
    end;

    procedure Reopen(var Order: Record "CG X135 Order")
    begin
        Order.TestField(Status, Order.Status::Released);
        Order.Status := Order.Status::Open;
        Order.Modify();
    end;

    procedure Post(var Order: Record "CG X135 Order")
    var
        PostedOrder: Record "CG X135 Posted Order";
    begin
        Order.TestField(Status, Order.Status::Open);
        Order.Status := Order.Status::Posted;
        Order."Posted On" := WorkDate();
        Order.Modify();

        PostedOrder.Init();
        PostedOrder."No." := Order."No.";
        PostedOrder.Amount := Order.Amount;
        PostedOrder."Posted On" := WorkDate();
        PostedOrder.Insert();
    end;
}
