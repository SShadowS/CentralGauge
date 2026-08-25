table 70710 "CG X111 Work Item"
{
    Caption = 'CG X111 Work Item';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; "Parent No."; Code[20])
        {
            Caption = 'Parent No.';
            DataClassification = CustomerContent;
        }
        field(3; "Sort Order"; Integer)
        {
            Caption = 'Sort Order';
            DataClassification = CustomerContent;
        }
        field(4; Status; Option)
        {
            Caption = 'Status';
            OptionMembers = Open,Done;
            OptionCaption = 'Open,Done';
            DataClassification = CustomerContent;
        }
        field(5; "Category Code"; Code[20])
        {
            Caption = 'Category Code';
            DataClassification = CustomerContent;
        }
        field(6; "Owner No."; Code[20])
        {
            Caption = 'Owner No.';
            DataClassification = CustomerContent;
        }
        field(7; "Estimated Hours"; Decimal)
        {
            Caption = 'Estimated Hours';
            DataClassification = CustomerContent;
        }
        field(8; "Open Direct Sub Hours"; Decimal)
        {
            Caption = 'Open Direct Sub Hours';
            FieldClass = FlowField;
            CalcFormula = sum("CG X111 Work Item"."Estimated Hours" where("Parent No." = field("No."), Status = const(Open)));
            Editable = false;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
        key(SortOrder; "Sort Order")
        {
        }
        key(CategoryCode; "Category Code")
        {
        }
        key(OwnerNo; "Owner No.")
        {
        }
        key(StatusKey; Status)
        {
        }
    }
}
