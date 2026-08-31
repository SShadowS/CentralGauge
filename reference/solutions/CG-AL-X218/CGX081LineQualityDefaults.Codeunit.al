codeunit 70463 "CG X081 Line Quality Defaults"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X081 Line Defaults Mgt", 'OnAfterAssignItemValues', '', false, false)]
    local procedure PullQualityGradeFromItem(var OrderLine: Record "CG X081 Order Line"; Item: Record "CG X081 Item")
    begin
        OrderLine."Quality Grade" := Item."Quality Grade";
    end;
}
