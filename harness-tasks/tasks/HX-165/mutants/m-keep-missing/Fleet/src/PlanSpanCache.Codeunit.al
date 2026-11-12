codeunit 70195 "CGR Plan Span Cache"
{
    SingleInstance = true;

    var
        Spans: Dictionary of [Code[20], Integer];

    procedure PlanSpanMonths(PlanCode: Code[20]): Integer
    var
        ServicePlan: Record "CGR Service Plan";
        Months: Integer;
    begin
        if Spans.Get(PlanCode, Months) then
            exit(Months);
        if ServicePlan.Get(PlanCode) then
            Months := ServicePlan."Interval Months";
        Spans.Add(PlanCode, Months);
        exit(Months);
    end;

    procedure ForgetPlanSpans()
    begin
        Clear(Spans);
    end;

    local procedure ForgetPlan(PlanCode: Code[20])
    begin
        if Spans.ContainsKey(PlanCode) then
            Spans.Remove(PlanCode);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Service Plan", 'OnAfterModifyEvent', '', false, false)]
    local procedure OnPlanModified(var Rec: Record "CGR Service Plan"; var xRec: Record "CGR Service Plan"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        ForgetPlan(Rec.Code);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Service Plan", 'OnAfterDeleteEvent', '', false, false)]
    local procedure OnPlanDeleted(var Rec: Record "CGR Service Plan")
    begin
        if Rec.IsTemporary() then
            exit;
        ForgetPlan(Rec.Code);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Service Plan", 'OnAfterRenameEvent', '', false, false)]
    local procedure OnPlanRenamed(var Rec: Record "CGR Service Plan"; var xRec: Record "CGR Service Plan")
    begin
        if Rec.IsTemporary() then
            exit;
        ForgetPlan(xRec.Code);
        ForgetPlan(Rec.Code);
    end;
}
