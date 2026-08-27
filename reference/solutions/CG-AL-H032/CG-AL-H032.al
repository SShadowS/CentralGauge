codeunit 70232 "CG H032 Relation Walker"
{
    Access = Public;

    procedure CountRelationFields(SourceTableNo: Integer; RelatedTableNo: Integer): Integer
    var
        FieldRec: Record Field;
    begin
        FieldRec.SetRange(TableNo, SourceTableNo);
        FieldRec.SetRange(RelationTableNo, RelatedTableNo);
        exit(FieldRec.Count());
    end;

    procedure GetNthRelationField(SourceTableNo: Integer; RelatedTableNo: Integer; N: Integer): Integer
    var
        FieldRec: Record Field;
        Counter: Integer;
    begin
        if N < 1 then
            exit(0);

        FieldRec.SetRange(TableNo, SourceTableNo);
        FieldRec.SetRange(RelationTableNo, RelatedTableNo);
        if FieldRec.FindSet() then
            repeat
                Counter += 1;
                if Counter = N then
                    exit(FieldRec."No.");
            until FieldRec.Next() = 0;

        exit(0);
    end;

    procedure GetAllRelationFieldNumbers(SourceTableNo: Integer; RelatedTableNo: Integer): List of [Integer]
    var
        FieldRec: Record Field;
        Result: List of [Integer];
    begin
        FieldRec.SetRange(TableNo, SourceTableNo);
        FieldRec.SetRange(RelationTableNo, RelatedTableNo);
        if FieldRec.FindSet() then
            repeat
                Result.Add(FieldRec."No.");
            until FieldRec.Next() = 0;

        exit(Result);
    end;

    procedure FirstRelationFieldName(SourceTableNo: Integer; RelatedTableNo: Integer): Text
    var
        FieldRec: Record Field;
    begin
        FieldRec.SetRange(TableNo, SourceTableNo);
        FieldRec.SetRange(RelationTableNo, RelatedTableNo);
        if FieldRec.FindFirst() then
            exit(FieldRec.FieldName);

        exit('');
    end;

    procedure GetNormalRelationFields(SourceTableNo: Integer; RelatedTableNo: Integer): List of [Integer]
    var
        FieldRec: Record Field;
        Result: List of [Integer];
    begin
        FieldRec.SetRange(TableNo, SourceTableNo);
        FieldRec.SetRange(RelationTableNo, RelatedTableNo);
        FieldRec.SetRange(Class, FieldRec.Class::Normal);
        if FieldRec.FindSet() then
            repeat
                Result.Add(FieldRec."No.");
            until FieldRec.Next() = 0;

        exit(Result);
    end;

    procedure ExcludeObsoleteCount(SourceTableNo: Integer; RelatedTableNo: Integer): Integer
    var
        FieldRec: Record Field;
    begin
        FieldRec.SetRange(TableNo, SourceTableNo);
        FieldRec.SetRange(RelationTableNo, RelatedTableNo);
        FieldRec.SetRange(ObsoleteState, FieldRec.ObsoleteState::No);
        exit(FieldRec.Count());
    end;

    procedure ListSourceTablesPointingTo(TargetTableNo: Integer): List of [Integer]
    var
        FieldRec: Record Field;
        Result: List of [Integer];
    begin
        FieldRec.SetRange(RelationTableNo, TargetTableNo);
        if FieldRec.FindSet() then
            repeat
                if not Result.Contains(FieldRec.TableNo) then
                    Result.Add(FieldRec.TableNo);
            until FieldRec.Next() = 0;

        exit(Result);
    end;
}