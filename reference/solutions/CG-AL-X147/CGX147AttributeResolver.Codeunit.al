codeunit 71313 "CG X147 Attribute Resolver"
{
    procedure ResolveValue(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]): Code[20]
    var
        AttrDefault: Record "CG X147 Attribute Default";
    begin
        AttrDefault.SetRange("Entity Type", EntityType);
        AttrDefault.SetRange("Entity No.", EntityNo);
        AttrDefault.SetRange("Attribute Code", AttributeCode);
        if AttrDefault.FindFirst() then
            exit(AttrDefault.Value);

        AttrDefault.SetRange("Entity No.", '');
        if AttrDefault.FindFirst() then
            exit(AttrDefault.Value);

        exit('');
    end;

    procedure SetEntityValue(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; NewValue: Code[20])
    var
        AttrDefault: Record "CG X147 Attribute Default";
    begin
        if not AttrDefault.Get(EntityType, EntityNo, AttributeCode) then begin
            AttrDefault.Init();
            AttrDefault."Entity Type" := EntityType;
            AttrDefault."Entity No." := EntityNo;
            AttrDefault."Attribute Code" := AttributeCode;
            AttrDefault.Insert();
        end;
        AttrDefault.Value := NewValue;
        AttrDefault.Modify();
    end;

    procedure SetTypeValue(EntityType: Enum "CG X147 Entity Type"; AttributeCode: Code[20]; NewValue: Code[20])
    var
        AttrDefault: Record "CG X147 Attribute Default";
    begin
        if not AttrDefault.Get(EntityType, '', AttributeCode) then begin
            AttrDefault.Init();
            AttrDefault."Entity Type" := EntityType;
            AttrDefault."Entity No." := '';
            AttrDefault."Attribute Code" := AttributeCode;
            AttrDefault.Insert();
        end;
        AttrDefault.Value := NewValue;
        AttrDefault.Modify();
    end;
}
