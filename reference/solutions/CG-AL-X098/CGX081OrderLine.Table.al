table 70461 "CG X081 Order Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            DataClassification = CustomerContent;
        }
        field(2; "Item No."; Code[20])
        {
            DataClassification = CustomerContent;
            TableRelation = "CG X081 Item";

            trigger OnValidate()
            var
                LineDefaultsMgt: Codeunit "CG X081 Line Defaults Mgt";
            begin
                LineDefaultsMgt.AssignItemValues(Rec);
            end;
        }
        field(3; "Quality Grade"; Code[10])
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
