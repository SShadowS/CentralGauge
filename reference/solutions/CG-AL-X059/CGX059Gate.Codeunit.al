codeunit 71460 "CG X059 Gate"
{
    Access = Internal;

    procedure RequireDraft(var Order: Record "CG X059 Order")
    begin
        // Two-argument TestField asserts EQUALITY with the given value.
        Order.TestField(Status, Order.Status::Draft);
    end;
}
