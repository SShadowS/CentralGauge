table 69200 "CG M043 Document Line"
{
    Caption = 'CG H2 Document Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Group Code"; Code[20])
        {
            Caption = 'Group Code';
            NotBlank = true;
        }
        field(2; "Line Code"; Code[20])
        {
            Caption = 'Line Code';
            NotBlank = true;
        }
        field(3; "Description"; Text[100])
        {
            Caption = 'Description';
        }
        field(4; "Sort Order"; Integer)
        {
            Caption = 'Sort Order';
        }
    }

    keys
    {
        key(PK; "Group Code", "Line Code")
        {
            Clustered = true;
        }
        key(SortKey; "Group Code", "Sort Order")
        {
        }
    }
}
