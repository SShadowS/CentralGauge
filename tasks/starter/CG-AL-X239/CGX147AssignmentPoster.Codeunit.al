codeunit 71314 "CG X147 Assignment Poster"
{
    procedure PostAssignment(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20])
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
        AssignmentEntry: Record "CG X147 Assignment Entry";
        ResolvedValue: Code[20];
    begin
        ResolvedValue := Resolver.ResolveValue(EntityType, EntityNo, AttributeCode);
        if ResolvedValue = '' then
            exit;

        AssignmentEntry.Init();
        AssignmentEntry."Entity Type" := EntityType;
        AssignmentEntry."Entity No." := EntityNo;
        AssignmentEntry."Attribute Code" := AttributeCode;
        AssignmentEntry."Resolved Value" := ResolvedValue;
        AssignmentEntry.Insert(true);
    end;
}
