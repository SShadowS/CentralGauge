pagecustomization "CG Hidden Field Editable" customizes "CG Cust Prereq Page"
{
    layout
    {
        addfirst(Content)
        {
            field(MyHiddenField; Rec."Hidden Field")
            {
                Caption = 'My Hidden Field';
                Editable = true;
            }
        }
    }
}