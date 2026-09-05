tableextension 70000 "Customer Table Extension" extends Customer
{
    fields
    {
        field(70000; "Preferred Contact Method"; Option)
        {
            Caption = 'Preferred Contact Method';
            OptionMembers = Email,Phone,Mail,SMS;
            OptionCaption = 'Email,Phone,Mail,SMS';
            DataClassification = CustomerContent;
        }
        field(70001; "Customer Notes"; Text[250])
        {
            Caption = 'Customer Notes';
            DataClassification = CustomerContent;
        }
        field(70002; "VIP Customer"; Boolean)
        {
            Caption = 'VIP Customer';
            DataClassification = CustomerContent;
        }
    }
}

pageextension 70000 "Customer Card Extension" extends "Customer Card"
{
    layout
    {
        addlast(General)
        {
            field("Preferred Contact Method"; Rec."Preferred Contact Method")
            {
                ApplicationArea = All;
                Caption = 'Preferred Contact Method';
                ToolTip = 'Specifies the customer''s preferred method of contact.';
            }
            field("Customer Notes"; Rec."Customer Notes")
            {
                ApplicationArea = All;
                Caption = 'Customer Notes';
                ToolTip = 'Specifies internal notes about the customer.';
            }
            field("VIP Customer"; Rec."VIP Customer")
            {
                ApplicationArea = All;
                Caption = 'VIP Customer';
                ToolTip = 'Specifies whether the customer is marked as a VIP customer.';
            }
        }
    }
}