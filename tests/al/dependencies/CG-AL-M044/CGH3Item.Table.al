table 69091 "CG M044 Item"
{
    Caption = 'CG H3 Item';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Group Code"; Code[20])
        {
            Caption = 'Group Code';
            TableRelation = "CG M044 Group".Code;
            NotBlank = true;
        }
        field(3; "Priority"; Code[20])
        {
            Caption = 'Priority';
        }
        field(4; "Description"; Text[100])
        {
            Caption = 'Description';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(GroupPriority; "Group Code", "Priority")
        {
        }
    }
}
